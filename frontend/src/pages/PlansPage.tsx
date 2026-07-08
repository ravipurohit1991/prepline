import { Button } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Plan, Recipe } from '../api/types';
import { parseIso } from '../lib/time';

export function fmtServe(iso: string): string {
  const date = parseIso(iso);
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function ServingsSummary({ plan, recipes }: { plan: Plan; recipes: Recipe[] }) {
  const overrides = plan.recipe_servings ?? {};
  const items = plan.recipe_ids
    .map((id) => {
      const recipe = recipes.find((r) => r.id === id);
      if (!recipe) return null;
      const target = overrides[id] ?? recipe.servings;
      const isScaled = target !== recipe.servings;
      return { id, target, isScaled };
    })
    .filter((x): x is { id: string; target: number; isScaled: boolean } => Boolean(x));
  if (items.length === 0) return null;
  const anyScaled = items.some((i) => i.isScaled);
  const minTarget = Math.min(...items.map((i) => i.target));
  const maxTarget = Math.max(...items.map((i) => i.target));
  const label =
    minTarget === maxTarget ? `serves ${minTarget}` : `serves ${minTarget}–${maxTarget}`;
  return <span className={`servings-badge${anyScaled ? ' scaled' : ''}`}>{label}</span>;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    Promise.all([api.listPlans(), api.listRecipes()])
      .then(([planData, recipeData]) => {
        setPlans(planData);
        setRecipes(recipeData);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const remove = async (plan: Plan) => {
    if (!window.confirm(`Delete "${plan.name}"?`)) return;
    await api.deletePlan(plan.id).catch((e: Error) => setError(e.message));
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Meals</h1>
          <p className="page-sub">
            Pick the dishes, set the serve time — Prepline writes the score.
          </p>
        </div>
        <div className="head-actions">
          <Button appearance="primary" onClick={() => navigate('/meals/new')}>
            New meal
          </Button>
        </div>
      </div>

      {error && <div className="warning-bar">⚠ {error}</div>}

      {plans && plans.length === 0 && (
        <div className="empty-state">
          <h2>No meals planned</h2>
          <p>A meal is a set of dishes that should land on the table together.</p>
          <Button appearance="primary" onClick={() => navigate('/meals/new')}>
            New meal
          </Button>
        </div>
      )}

      <div className="card-grid">
        {plans?.map((plan) => (
          <div key={plan.id} className="panel recipe-card">
            <h3>{plan.name}</h3>
            <div className="card-meta">
              <span>{fmtServe(plan.serve_at)}</span>
              <span>{plan.recipe_ids.length} dishes</span>
            </div>
            <div>
              <ServingsSummary plan={plan} recipes={recipes} />
            </div>
            <div className="card-actions">
              <Link to={`/meals/${plan.id}`}>
                <Button appearance="primary" size="small">
                  Open score
                </Button>
              </Link>
              <Button appearance="subtle" size="small" onClick={() => remove(plan)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
