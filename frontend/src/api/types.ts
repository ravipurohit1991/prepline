export type Attention = 'active' | 'passive';

export interface EquipmentUse {
  kind: string;
  temp_c?: number | null;
}

export interface StepOut {
  id: string;
  position: number;
  name: string;
  instruction: string;
  duration_min: number;
  attention: Attention;
  equipment: EquipmentUse[];
  depends_on: string[];
  hold_max_min: number;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  servings: number;
  tags: string[];
  ingredients: string[];
  created_at: string;
  steps: StepOut[];
}

export interface StepIn {
  name: string;
  instruction: string;
  duration_min: number;
  attention: Attention;
  equipment: EquipmentUse[];
  depends_on: number[] | null;
  hold_max_min: number;
}

export interface RecipeIn {
  name: string;
  description: string;
  servings: number;
  tags: string[];
  ingredients: string[];
  steps: StepIn[];
}

export interface Resources {
  cooks: number;
  burners: number;
  oven_slots: number;
}

export interface Plan {
  id: string;
  name: string;
  serve_at: string;
  recipe_ids: string[];
  resources: Resources;
  recipe_servings: Record<string, number>;
  created_at: string;
}

export interface PlanIn {
  name: string;
  serve_at: string;
  recipe_ids: string[];
  resources: Resources;
  recipe_servings?: Record<string, number>;
}

export interface ScheduleEntry {
  step_id: string;
  recipe_id: string;
  recipe_name: string;
  name: string;
  instruction: string;
  attention: Attention;
  equipment: EquipmentUse[];
  duration_min: number;
  hold_max_min: number;
  start: string;
  end: string;
  servings: number | null;
}

export interface Warning {
  code: string;
  message: string;
  step_id: string | null;
}

export interface Schedule {
  plan_id: string;
  plan_name: string;
  serve_at: string;
  serve_eta: string;
  serve_push_min: number;
  start_at: string;
  resources: Resources;
  recipes: { id: string; name: string; servings: number }[];
  entries: ScheduleEntry[];
  warnings: Warning[];
}

export interface ShoppingListRecipeRef {
  recipe_id: string;
  recipe_name: string;
}

export interface ShoppingListItem {
  display: string;
  normalized: string;
  count: number;
  recipes: ShoppingListRecipeRef[];
}

export interface ShoppingList {
  plan_id: string;
  plan_name: string;
  items: ShoppingListItem[];
  warnings: Warning[];
}

export type StepStatus = 'pending' | 'running' | 'done';

export interface SessionStep {
  step_id: string;
  recipe_id: string;
  recipe_name: string;
  name: string;
  instruction: string;
  attention: Attention;
  equipment: EquipmentUse[];
  duration_min: number;
  hold_max_min: number;
  status: StepStatus;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  servings: number | null;
}

export interface SessionState {
  type: 'state';
  session_id: string;
  plan_id: string;
  plan_name: string;
  status: 'live' | 'done';
  now: string;
  serve_at: string;
  serve_eta: string;
  serve_push_min: number;
  steps: SessionStep[];
  warnings: Warning[];
}

export type SessionEvent =
  | { type: 'start_step'; step_id: string }
  | { type: 'complete_step'; step_id: string }
  | { type: 'delay_step'; step_id: string; minutes: number }
  | { type: 'reset_step'; step_id: string }
  | { type: 'finish' };
