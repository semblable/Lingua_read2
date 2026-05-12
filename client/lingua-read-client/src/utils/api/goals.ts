import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';

export type GoalsList = ResponseOf<'/api/Goals', 'get'>;
export type Goal = ResponseOf<'/api/Goals/{id}', 'get'>;
export type GoalSuggestion = ResponseOf<'/api/Goals/suggestions', 'get'>;
export type CreateGoalInput = RequestBodyOf<'/api/Goals', 'post'>;
export type UpdateGoalInput = RequestBodyOf<'/api/Goals/{id}', 'put'>;

const tzOffset = (): number => -new Date().getTimezoneOffset();

export const getGoals = (status: string = 'active'): Promise<GoalsList> => {
  const params = new URLSearchParams({ status, timezoneOffsetMinutes: String(tzOffset()) });
  return fetchApi<GoalsList>(`/goals?${params.toString()}`);
};

export const getGoal = (goalId: number | string): Promise<Goal> => {
  const params = new URLSearchParams({ timezoneOffsetMinutes: String(tzOffset()) });
  return fetchApi<Goal>(`/goals/${goalId}?${params.toString()}`);
};

export const createGoal = (payload: CreateGoalInput): Promise<Goal> => {
  const params = new URLSearchParams({ timezoneOffsetMinutes: String(tzOffset()) });
  return fetchApi<Goal>(`/goals?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const updateGoal = (
  goalId: number | string,
  payload: UpdateGoalInput
): Promise<Goal> => {
  const params = new URLSearchParams({ timezoneOffsetMinutes: String(tzOffset()) });
  return fetchApi<Goal>(`/goals/${goalId}?${params.toString()}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

export const archiveGoal = (goalId: number | string): Promise<unknown> =>
  fetchApi(`/goals/${goalId}/archive`, { method: 'POST' });

export const restoreGoal = (goalId: number | string): Promise<unknown> =>
  fetchApi(`/goals/${goalId}/restore`, { method: 'POST' });

export const deleteGoal = (goalId: number | string): Promise<unknown> =>
  fetchApi(`/goals/${goalId}`, { method: 'DELETE' });

export type GoalSuggestionArgs = {
  type: string;
  languageId?: number | string | null;
  recurrence?: number;
  mode?: number;
};

export const getGoalSuggestion = ({
  type,
  languageId = null,
  recurrence = 0,
  mode = 1
}: GoalSuggestionArgs): Promise<GoalSuggestion> => {
  const params = new URLSearchParams({
    type,
    recurrence: String(recurrence),
    mode: String(mode),
    timezoneOffsetMinutes: String(tzOffset())
  });
  if (languageId !== null && languageId !== undefined) {
    params.append('languageId', String(languageId));
  }
  return fetchApi<GoalSuggestion>(`/goals/suggestions?${params.toString()}`);
};
