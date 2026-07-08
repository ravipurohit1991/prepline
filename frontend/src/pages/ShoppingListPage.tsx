import { Button } from '@fluentui/react-components';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Plan, Recipe, ShoppingList } from '../api/types';
import { WarningsBar } from '../components/WarningsBar';
import { fmtServe } from './PlansPage';

export default function ShoppingListPage() {
  const { planId } = useParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [list, setList] = useState<ShoppingList | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!planId) return;
    Promise.all([api.getPlan(planId), api.getShoppingList(planId), api.listRecipes()])
      .then(([planData, listData, recipeData]) => {
        setPlan(planData);
        setList(listData);
        setRecipes(recipeData);
      })
      .catch((e: Error) => setError(e.message));
  }, [planId]);

  const scaled = useMemo(() => {
    if (!plan) return false;
    const overrides = plan.recipe_servings ?? {};
    return plan.recipe_ids.some((id) => {
      const recipe = recipes.find((r) => r.id === id);
      if (!recipe) return false;
      const target = overrides[id];
      return target !== undefined && target !== recipe.servings;
    });
  }, [plan, recipes]);

  const { uncategorized, byRecipe } = useMemo(() => {
    if (!list)
      return {
        uncategorized: [] as ShoppingList['items'],
        byRecipe: {} as Record<string, ShoppingList['items']>,
      };
    const uncategorized: ShoppingList['items'] = [];
    const byRecipe: Record<string, ShoppingList['items']> = {};
    for (const item of list.items) {
      if (item.recipes.length === 1) {
        const recipe = item.recipes[0];
        byRecipe[recipe.recipe_id] = byRecipe[recipe.recipe_id] ?? [];
        byRecipe[recipe.recipe_id].push(item);
      } else {
        uncategorized.push(item);
      }
    }
    return { uncategorized, byRecipe };
  }, [list]);

  if (!plan || !list) {
    return (
      <div className="page">
        {error ? <div className="warning-bar">⚠ {error}</div> : <p>Loading the shopping list…</p>}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{plan.name}</h1>
          <p className="page-sub">
            Shopping list · {fmtServe(plan.serve_at)} · {list.items.length} items
            {scaled && (
              <>
                {' '}
                <span className="servings-badge scaled" style={{ verticalAlign: 'middle' }}>
                  scaled
                </span>
              </>
            )}
          </p>
        </div>
        <div className="head-actions">
          <Link to={`/meals/${plan.id}`}>
            <Button appearance="secondary">Back to score</Button>
          </Link>
        </div>
      </div>

      {error && <div className="warning-bar">⚠ {error}</div>}
      <WarningsBar warnings={list.warnings} />

      {list.items.length === 0 ? (
        <div className="empty-state">
          <h2>No ingredients</h2>
          <p>The recipes in this plan do not have any ingredients yet.</p>
          <Link to={`/meals/${plan.id}`}>
            <Button appearance="primary">Back to score</Button>
          </Link>
        </div>
      ) : (
        <div className="card-grid shopping-grid">
          {uncategorized.length > 0 && (
            <div className="panel shopping-col">
              <h3>Shared</h3>
              <p className="page-sub">Appears in more than one dish.</p>
              <ul className="shopping-list">
                {uncategorized.map((item) => (
                  <li key={item.normalized}>
                    <span className="shopping-item">{item.display}</span>
                    <span className="shopping-meta">
                      {item.count}× · {item.recipes.map((r) => r.recipe_name).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.recipe_ids.map((recipeId) => {
            const items = byRecipe[recipeId];
            if (!items || items.length === 0) return null;
            return (
              <div key={recipeId} className="panel shopping-col">
                <h3>{items[0].recipes[0].recipe_name}</h3>
                <ul className="shopping-list">
                  {items.map((item) => (
                    <li key={item.normalized}>
                      <span className="shopping-item">{item.display}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
