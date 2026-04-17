import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCredentialDto {
  @IsString()
  @MinLength(8)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;
}
