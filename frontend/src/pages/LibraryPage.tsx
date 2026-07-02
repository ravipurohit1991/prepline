import { Button } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Recipe } from '../api/types';
import { fmtDuration } from '../lib/time';

export default function LibraryPage() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    api
      .listRecipes()
      .then(setRecipes)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const remove = async (recipe: Recipe) => {
    if (!window.confirm(`Delete "${recipe.name}"? Meal plans using it will lose this dish.`)) {
      return;
    }
    await api.deleteRecipe(recipe.id).catch((e: Error) => setError(e.message));
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-sub">Every dish you can put on a timeline.</p>
        </div>
        <div className="head-actions">
          <Button appearance="primary" onClick={() => navigate('/recipes/new')}>
            New recipe
          </Button>
        </div>
      </div>

      {error && <div className="warning-bar">⚠ {error}</div>}

      {recipes && recipes.length === 0 && (
        <div className="empty-state">
          <h2>No recipes yet</h2>
          <p>Add your first dish — a recipe is just steps with durations.</p>
          <Button appearance="primary" onClick={() => navigate('/recipes/new')}>
            New recipe
          </Button>
        </div>
      )}

      <div className="card-grid">
        {recipes?.map((recipe) => {
          const total = recipe.steps.reduce((sum, s) => sum + s.duration_min, 0);
          const handsOn = recipe.steps
            .filter((s) => s.attention === 'active')
            .reduce((sum, s) => sum + s.duration_min, 0);
          return (
            <div key={recipe.id} className="panel recipe-card">
              <h3>{recipe.name}</h3>
              <p>{recipe.description || 'No description.'}</p>
              <div className="card-meta">
                <span>{recipe.steps.length} steps</span>
                <span>{fmtDuration(total)} total</span>
                <span>{fmtDuration(handsOn)} hands-on</span>
              </div>
              {recipe.tags.length > 0 && (
                <div className="chip-row">
                  {recipe.tags.map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="card-actions">
                <Link to={`/recipes/${recipe.id}`}>
                  <Button appearance="secondary" size="small">
                    Edit
                  </Button>
                </Link>
                <Button appearance="subtle" size="small" onClick={() => remove(recipe)}>
                  Delete
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
