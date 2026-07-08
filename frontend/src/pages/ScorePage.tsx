import { Button, Input, SpinButton } from '@fluentui/react-components';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Plan, Recipe, Schedule } from '../api/types';
import { Timeline, type TimelineBlock, type TimelineTrack } from '../components/Timeline';
import { WarningsBar } from '../components/WarningsBar';
import {
  fmtClock,
  fmtDuration,
  fromLocalInputValue,
  minutesBetween,
  parseIso,
  toLocalInputValue,
} from '../lib/time';
import { effectiveServings } from '../lib/scaling';
import { hueFor } from '../theme';

export default function ScorePage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [serveLocal, setServeLocal] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [savingServingsId, setSavingServingsId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!planId) return;
    Promise.all([api.getPlan(planId), api.getSchedule(planId), api.listRecipes()])
      .then(([planData, scheduleData, recipeData]) => {
        setPlan(planData);
        setSchedule(scheduleData);
        setRecipes(recipeData);
        setServeLocal(toLocalInputValue(parseIso(planData.serve_at)));
      })
      .catch((e: Error) => setError(e.message));
  }, [planId]);
  useEffect(load, [load]);

  const updateServe = async () => {
    if (!plan) return;
    try {
      await api.updatePlan(plan.id, {
        name: plan.name,
        serve_at: fromLocalInputValue(serveLocal),
        recipe_ids: plan.recipe_ids,
        resources: plan.resources,
        recipe_servings: plan.recipe_servings,
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const updateServingsFor = async (recipeId: string, value: number) => {
    if (!plan) return;
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const next = { ...plan.recipe_servings };
    if (value === recipe.servings) {
      delete next[recipeId];
    } else {
      next[recipeId] = value;
    }
    setSavingServingsId(recipeId);
    setError('');
    try {
      const updated = await api.updatePlan(plan.id, {
        name: plan.name,
        serve_at: plan.serve_at,
        recipe_ids: plan.recipe_ids,
        resources: plan.resources,
        recipe_servings: next,
      });
      setPlan(updated);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingServingsId(null);
    }
  };

  const startCooking = async () => {
    if (!plan) return;
    setStarting(true);
    try {
      const session = await api.createSession(plan.id);
      navigate(`/cook/${session.session_id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  const { tracks, blocks } = useMemo(() => {
    if (!schedule) return { tracks: [] as TimelineTrack[], blocks: [] as TimelineBlock[] };
    const tracks: TimelineTrack[] = schedule.recipes.map((r, i) => ({
      id: r.id,
      name: r.name,
      hueIndex: i,
    }));
    const blocks: TimelineBlock[] = schedule.entries.map((entry) => ({
      id: entry.step_id,
      trackId: entry.recipe_id,
      name: entry.name,
      start: parseIso(entry.start),
      end: parseIso(entry.end),
      attention: entry.attention,
      equipment: entry.equipment,
    }));
    return { tracks, blocks };
  }, [schedule]);

  const stats = useMemo(() => {
    if (!schedule) return null;
    const serve = parseIso(schedule.serve_at);
    const start = parseIso(schedule.start_at);
    const handsOn = schedule.entries
      .filter((e) => e.attention === 'active')
      .reduce((sum, e) => sum + e.duration_min, 0);
    return {
      serve: fmtClock(serve),
      start: fmtClock(start),
      span: fmtDuration(minutesBetween(start, serve)),
      handsOn: fmtDuration(handsOn),
    };
  }, [schedule]);

  const miseRecipes = useMemo(() => {
    if (!plan) return [];
    return plan.recipe_ids
      .map((id, i) => {
        const recipe = recipes.find((r) => r.id === id);
        if (!recipe) return null;
        const target = effectiveServings(id, recipe.servings, plan.recipe_servings);
        const isScaled = target !== recipe.servings;
        return { recipe, hue: hueFor(i), target, isScaled };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [plan, recipes]);

  if (!plan || !schedule) {
    return (
      <div className="page">
        {error ? <div className="warning-bar">⚠ {error}</div> : <p>Loading the score…</p>}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="score-head">
        <div>
          <h1 className="page-title">{plan.name}</h1>
          <p className="page-sub">
            {schedule.recipes.length} dishes compiled into one line. Serve it, and every dish lands
            together.
          </p>
        </div>
        <div className="head-actions">
          <Input
            type="datetime-local"
            aria-label="Serve at"
            value={serveLocal}
            onChange={(_, d) => setServeLocal(d.value)}
          />
          <Button appearance="secondary" onClick={updateServe}>
            Reschedule
          </Button>
          <Link to={`/meals/${plan.id}/shopping`}>
            <Button appearance="secondary">Shopping list</Button>
          </Link>
          <Button appearance="primary" disabled={starting} onClick={startCooking}>
            {starting ? 'Starting…' : 'Start cooking'}
          </Button>
        </div>
      </div>

      {error && <div className="warning-bar">⚠ {error}</div>}
      <WarningsBar warnings={schedule.warnings} />

      <div className="score-stats">
        <div className="stat">
          <span className="stat-label">First knife</span>
          <span className="stat-value">{stats?.start}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Serve</span>
          <span className="stat-value">{stats?.serve}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total span</span>
          <span className="stat-value">{stats?.span}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Hands-on</span>
          <span className="stat-value">{stats?.handsOn}</span>
        </div>
      </div>

      <div className="timeline-wrap">
        <Timeline
          tracks={tracks}
          blocks={blocks}
          serveAt={parseIso(schedule.serve_at)}
          serveEta={parseIso(schedule.serve_eta)}
          capacities={plan.resources}
        />
      </div>

      {miseRecipes.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, margin: '22px 0 0' }}>Mise en place</h2>
          <div className="mise-grid">
            {miseRecipes.map(({ recipe, hue, target, isScaled }) => (
              <div key={recipe.id} className="panel mise-col">
                <h4>
                  <span className="hue-dot" style={{ background: hue.deep }} />
                  {recipe.name}
                  <span
                    className="servings-row"
                    style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 12 }}
                  >
                    <span className={`servings-badge${isScaled ? ' scaled' : ''}`}>
                      serves {target}
                    </span>
                    <SpinButton
                      className="servings-input"
                      value={target}
                      min={1}
                      max={50}
                      aria-label={`Servings for ${recipe.name}`}
                      onChange={(_, d) => updateServingsFor(recipe.id, d.value ?? target)}
                    />
                    {savingServingsId === recipe.id && (
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>saving…</span>
                    )}
                  </span>
                </h4>
                <ul>
                  {recipe.ingredients.map((ingredient) => (
                    <li key={ingredient}>{ingredient}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
