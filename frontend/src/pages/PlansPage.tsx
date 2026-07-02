import { Button } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Plan } from '../api/types';
import { parseIso } from '../lib/time';

function fmtServe(iso: string): string {
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

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    api
      .listPlans()
      .then(setPlans)
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
          <p className="page-sub">Pick the dishes, set the serve time — Prepline writes the score.</p>
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
