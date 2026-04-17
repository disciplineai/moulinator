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
  type AuthTokens,
  type IAuditService,
  type Role,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 12;

interface Subject {
  id: string;
  email: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {}

  async signup(email: string, password: string, ip?: string): Promise<AuthTokens> {
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
    return this.issueTokens({ id: user.id, email: user.email, role: user.role });
  }

  async login(email: string, password: string, ip?: string): Promise<AuthTokens> {
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
    return this.issueTokens({ id: user.id, email: user.email, role: user.role });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const secret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!secret) {
      throw new UnauthorizedException({ error: 'refresh_misconfigured' });
    }
    let payload: { sub: string; email: string; role: Role; type: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret });
    } catch {
      throw new UnauthorizedException({ error: 'invalid_refresh_token' });
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException({ error: 'invalid_token_type' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException({ error: 'user_not_found' });
    }
    return this.issueTokens({ id: user.id, email: user.email, role: user.role });
  }

  private async issueTokens(subject: Subject): Promise<AuthTokens> {
    const accessTtl = Number(this.config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
    const refreshTtl = Number(this.config.get('JWT_REFRESH_TTL_SECONDS') ?? 60 * 60 * 24 * 30);
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!accessSecret || !refreshSecret) {
      throw new Error('JWT secrets are not configured');
    }
    const base = { sub: subject.id, email: subject.email, role: subject.role };
    const access_token = await this.jwt.signAsync(
      { ...base, type: 'access' },
      { secret: accessSecret, expiresIn: accessTtl },
    );
    const refresh_token = await this.jwt.signAsync(
      { ...base, type: 'refresh' },
      { secret: refreshSecret, expiresIn: refreshTtl },
    );
    return { access_token, refresh_token, expires_in: accessTtl };
  }
}
