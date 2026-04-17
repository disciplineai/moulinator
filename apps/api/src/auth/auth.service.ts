import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { ulid } from 'ulid';
import {
  AUDIT_SERVICE,
  REFRESH_TOKEN_STORE,
  type AuthTokens,
  type IAuditService,
  type IRefreshTokenStore,
  type IssuedRefreshToken,
  type Role,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 12;

interface Subject {
  id: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  tokens: AuthTokens;
  refresh: IssuedRefreshToken;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
    @Inject(REFRESH_TOKEN_STORE)
    private readonly refreshStore: IRefreshTokenStore,
  ) {}

  async signup(email: string, password: string, ip?: string): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({ error: 'email_taken' });
    }
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let user;
    try {
      user = await this.prisma.user.create({
        data: { id: ulid(), email, password_hash },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({ error: 'email_taken' });
      }
      throw err;
    }
    await this.audit.log({
      actorId: user.id,
      action: 'auth.signup',
      entity: 'user',
      entityId: user.id,
      ip,
    });
    return this.issue({ id: user.id, email: user.email, role: user.role });
  }

  async login(email: string, password: string, ip?: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await this.audit.log({
        actorId: null,
        action: 'auth.login_failed',
        entity: 'user',
        metadata: { email, reason: 'not_found' },
        ip,
      });
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await this.audit.log({
        actorId: user.id,
        action: 'auth.login_failed',
        entity: 'user',
        entityId: user.id,
        metadata: { reason: 'bad_password' },
        ip,
      });
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }
    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      ip,
    });
    return this.issue({ id: user.id, email: user.email, role: user.role });
  }

  /**
   * Refresh: validate the refresh cookie, rotate the jti, return new
   * tokens. Reuse detection is backend-core's job inside
   * IRefreshTokenStore.rotate — we surface it as a 401 after audit.
   */
  async refresh(cookieToken: string | undefined, ip?: string): Promise<AuthResult> {
    if (!cookieToken) {
      await this.audit.log({
        actorId: null,
        action: 'auth.refresh_failed',
        metadata: { reason: 'missing_cookie' },
        ip,
      });
      throw new UnauthorizedException({ error: 'missing_refresh_cookie' });
    }
    const verified = await this.refreshStore.verify(cookieToken);
    if (!verified) {
      await this.audit.log({
        actorId: null,
        action: 'auth.refresh_failed',
        metadata: { reason: 'invalid_or_revoked' },
        ip,
      });
      throw new UnauthorizedException({ error: 'invalid_refresh_token' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: verified.userId } });
    if (!user) {
      await this.audit.log({
        actorId: verified.userId,
        action: 'auth.refresh_failed',
        metadata: { reason: 'user_not_found' },
        ip,
      });
      throw new UnauthorizedException({ error: 'user_not_found' });
    }
    const ttl = this.refreshTtl();
    let rotated: IssuedRefreshToken;
    try {
      rotated = await this.refreshStore.rotate(verified.jti, user.id, ttl);
    } catch {
      await this.audit.log({
        actorId: user.id,
        action: 'auth.refresh_failed',
        metadata: { reason: 'rotate_failed' },
        ip,
      });
      throw new UnauthorizedException({ error: 'invalid_refresh_token' });
    }
    await this.audit.log({
      actorId: user.id,
      action: 'auth.refresh',
      entity: 'user',
      entityId: user.id,
      ip,
    });
    const tokens = await this.issueAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return { tokens, refresh: rotated };
  }

  /**
   * Logout is idempotent: missing cookie or already-revoked jti still
   * returns 204. Audit whatever we observed.
   */
  async logout(cookieToken: string | undefined, ip?: string): Promise<void> {
    if (!cookieToken) return;
    const verified = await this.refreshStore.verify(cookieToken);
    if (!verified) return;
    await this.refreshStore.revoke(verified.jti);
    await this.audit.log({
      actorId: verified.userId,
      action: 'auth.logout',
      entity: 'user',
      entityId: verified.userId,
      ip,
    });
  }

  private async issue(subject: Subject): Promise<AuthResult> {
    const tokens = await this.issueAccessToken(subject);
    const refresh = await this.refreshStore.issue(subject.id, this.refreshTtl());
    return { tokens, refresh };
  }

  private async issueAccessToken(subject: Subject): Promise<AuthTokens> {
    const accessTtl = Number(this.config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }
    const access_token = await this.jwt.signAsync(
      { sub: subject.id, email: subject.email, role: subject.role, type: 'access' },
      { secret: accessSecret, expiresIn: accessTtl },
    );
    return { access_token, expires_in: accessTtl };
  }

  private refreshTtl(): number {
    return Number(this.config.get('JWT_REFRESH_TTL_SECONDS') ?? 60 * 60 * 24 * 30);
  }
}
