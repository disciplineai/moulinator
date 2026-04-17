import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthResult, AuthService } from './auth.service';
import { LoginDto, SignupDto } from './dto';
import { Public } from './public.decorator';

const REFRESH_COOKIE = 'mou_rt';
// Scope the cookie to /auth so it's attached to /auth/refresh + /auth/logout
// but never to any other route. (Using /auth instead of /auth/refresh so
// /auth/logout — which also needs the cookie — works without a second cookie.)
const REFRESH_PATH = '/auth';

@Controller('auth')
@Public()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup')
  @HttpCode(201)
  async signup(
    @Body() dto: SignupDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.signup(dto.email, dto.password, ip);
    this.setRefreshCookie(res, result);
    return result.tokens;
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password, ip);
    this.setRefreshCookie(res, result);
    return result.tokens;
  }

  /**
   * POST /auth/refresh — consumes httpOnly mou_rt cookie, rotates it,
   * returns a fresh access token. CSRF-lite: requires a custom
   * `X-Moulinator-Refresh: 1` header that cross-origin simple requests
   * cannot set without a preflight, so a drive-by `<img>` cannot trigger.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Headers('x-moulinator-refresh') csrfHeader: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (csrfHeader !== '1') {
      throw new BadRequestException({
        error: 'missing_csrf_header',
        message: 'X-Moulinator-Refresh: 1 is required on this endpoint',
      });
    }
    const cookie = this.readCookie(req);
    const result = await this.auth.refresh(cookie, ip);
    this.setRefreshCookie(res, result);
    return result.tokens;
  }

  /**
   * POST /auth/logout — idempotent. Revokes the jti for the incoming
   * cookie (if any) and clears the cookie on the response.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = this.readCookie(req);
    await this.auth.logout(cookie, ip);
    this.clearRefreshCookie(res);
  }

  private readCookie(req: Request): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_COOKIE];
  }

  private setRefreshCookie(res: Response, result: AuthResult): void {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    const ttlMs = Math.max(0, result.refresh.expiresAt.getTime() - Date.now());
    res.cookie(REFRESH_COOKIE, result.refresh.token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: REFRESH_PATH,
      maxAge: ttlMs,
    });
  }

  private clearRefreshCookie(res: Response): void {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: REFRESH_PATH,
    });
  }
}
