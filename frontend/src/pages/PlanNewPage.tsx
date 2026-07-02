import { Button, Checkbox, Input, SpinButton } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Recipe } from '../api/types';
import { fmtDuration, fromLocalInputValue, toLocalInputValue } from '../lib/time';

function defaultServe(): string {
  const date = new Date(Date.now() + 150 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return toLocalInputValue(date);
}

export default function PlanNewPage() {
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [name, setName] = useState('Dinner');
  const [serveLocal, setServeLocal] = useState(defaultServe);
  const [selected, setSelected] = useState<string[]>([]);
  const [cooks, setCooks] = useState(1);
  const [burners, setBurners] = useState(4);
  const [ovenSlots, setOvenSlots] = useState(2);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .listRecipes()
      .then(setRecipes)
      .catch((e: Error) => setError(e.message));
  }, []);

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const create = async () => {
    setSaving(true);
    setError('');
    try {
      const plan = await api.createPlan({
        name: name.trim(),
        serve_at: fromLocalInputValue(serveLocal),
        recipe_ids: selected,
        resources: { cooks, burners, oven_slots: ovenSlots },
      });
      navigate(`/meals/${plan.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">New meal</h1>
          <p className="page-sub">Everything you pick here will be scheduled to finish together.</p>
        </div>
        <div className="head-actions">
          <Button appearance="secondary" onClick={() => navigate('/meals')}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            disabled={saving || selected.length === 0 || !name.trim()}
            onClick={create}
          >
            {saving ? 'Building…' : 'Build the score'}
          </Button>
        </div>
      </div>

      {error && <div className="warning-bar">⚠ {error}</div>}

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="form-grid">
          <div>
            <label className="field-label" htmlFor="plan-name">
              Name
            </label>
            <Input
              id="plan-name"
              value={name}
              onChange={(_, d) => setName(d.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="plan-serve">
              Serve at
            </label>
            <Input
              id="plan-serve"
              type="datetime-local"
              value={serveLocal}
              onChange={(_, d) => setServeLocal(d.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 20 }} className="full">
            <div>
              <label className="field-label" htmlFor="plan-cooks">
                Cooks
              </label>
              <SpinButton
                id="plan-cooks"
                value={cooks}
                min={1}
                max={6}
                onChange={(_, d) => setCooks(d.value ?? cooks)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="plan-burners">
                Burners
              </label>
              <SpinButton
                id="plan-burners"
                value={burners}
                min={0}
                max={12}
                onChange={(_, d) => setBurners(d.value ?? burners)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="plan-oven">
                Oven slots
              </label>
              <SpinButton
                id="plan-oven"
                value={ovenSlots}
                min={0}
                max={6}
                onChange={(_, d) => setOvenSlots(d.value ?? ovenSlots)}
              />
            </div>
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
        Dishes <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({selected.length} selected)</span>
      </h2>
      {recipes.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          The library is empty — add a recipe first, then come back to build a meal.
        </p>
      )}
      <div className="card-grid">
        {recipes.map((recipe) => {
          const total = recipe.steps.reduce((sum, s) => sum + s.duration_min, 0);
          const checked = selected.includes(recipe.id);
          return (
            <label key={recipe.id} className="panel recipe-card" style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Checkbox checked={checked} onChange={(_, d) => toggle(recipe.id, Boolean(d.checked))} />
                <h3 style={{ margin: 0 }}>{recipe.name}</h3>
              </div>
              <div className="card-meta">
                <span>{recipe.steps.length} steps</span>
                <span>{fmtDuration(total)}</span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
