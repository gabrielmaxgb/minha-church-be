import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const GIVING_SUBSCRIPTION_CONTACT_REASONS = [
  'cancel_help',
  'verify_cancel',
  'other',
] as const;

export type GivingSubscriptionContactReason =
  (typeof GIVING_SUBSCRIPTION_CONTACT_REASONS)[number];

export class ContactGivingSubscriptionDto {
  @IsIn(GIVING_SUBSCRIPTION_CONTACT_REASONS)
  reason!: GivingSubscriptionContactReason;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  replyEmail?: string;
}
