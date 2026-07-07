import type { Plan, PlanIn, Recipe, RecipeIn, Schedule, SessionState, ShoppingList } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // keep the status text
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listRecipes: () => request<Recipe[]>('/api/recipes'),
  getRecipe: (id: string) => request<Recipe>(`/api/recipes/${id}`),
  createRecipe: (payload: RecipeIn) =>
    request<Recipe>('/api/recipes', { method: 'POST', body: JSON.stringify(payload) }),
  updateRecipe: (id: string, payload: RecipeIn) =>
    request<Recipe>(`/api/recipes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRecipe: (id: string) => request<void>(`/api/recipes/${id}`, { method: 'DELETE' }),

  listPlans: () => request<Plan[]>('/api/plans'),
  getPlan: (id: string) => request<Plan>(`/api/plans/${id}`),
  createPlan: (payload: PlanIn) =>
    request<Plan>('/api/plans', { method: 'POST', body: JSON.stringify(payload) }),
  updatePlan: (id: string, payload: PlanIn) =>
    request<Plan>(`/api/plans/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deletePlan: (id: string) => request<void>(`/api/plans/${id}`, { method: 'DELETE' }),
  getSchedule: (planId: string) => request<Schedule>(`/api/plans/${planId}/schedule`),
  getShoppingList: (planId: string) => request<ShoppingList>(`/api/plans/${planId}/shopping-list`),

  createSession: (planId: string) =>
    request<SessionState>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId }),
    }),
  getSession: (id: string) => request<SessionState>(`/api/sessions/${id}`),
};
