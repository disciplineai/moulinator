import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, SignupDto } from './dto';
import { Public } from './public.decorator';

@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(201)
  signup(@Body() dto: SignupDto, @Ip() ip: string) {
    return this.auth.signup(dto.email, dto.password, ip);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.email, dto.password, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }
}
