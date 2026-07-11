import { IsIn, IsOptional } from 'class-validator';

export const EVENT_MUTATION_SCOPES = [
  'this',
  'this_and_following',
  'all',
] as const;

export type EventMutationScope = (typeof EVENT_MUTATION_SCOPES)[number];

export class EventMutationScopeDto {
  @IsOptional()
  @IsIn(EVENT_MUTATION_SCOPES)
  scope?: EventMutationScope;
}
