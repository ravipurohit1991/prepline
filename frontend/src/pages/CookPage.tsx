import { Button, FluentProvider } from '@fluentui/react-components';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Plan, SessionStep } from '../api/types';
import { Timeline, type TimelineBlock, type TimelineTrack } from '../components/Timeline';
import { WarningsBar } from '../components/WarningsBar';
import { useSession } from '../hooks/useSession';
import { fmtClock, fmtCountdown, minutesBetween, parseIso } from '../lib/time';
import { hueFor, serviceTheme } from '../theme';

function RunningCard({
  step,
  hueIndex,
  now,
  onDone,
  onDelay,
  onUndo,
}: {
  step: SessionStep;
  hueIndex: number;
  now: Date;
  onDone: () => void;
  onDelay: () => void;
  onUndo: () => void;
}) {
  const hue = hueFor(hueIndex);
  const start = parseIso(step.actual_start ?? step.planned_start);
  const end = parseIso(step.planned_end);
  const remaining = (end.getTime() - now.getTime()) / 1000;
  const overdue = remaining < 0;
  const fraction = Math.min(
    1,
    Math.max(0, (now.getTime() - start.getTime()) / Math.max(1, end.getTime() - start.getTime())),
  );
  return (
    <div className="step-card running" style={{ borderLeftColor: hue.service }}>
      <div className="card-top">
        <div>
          <span className="step-name">{step.name}</span>
          <div className="recipe-name">{step.recipe_name}</div>
        </div>
        <span className={`countdown${overdue ? ' overdue' : ''}`}>
          {overdue ? `+${fmtCountdown(-remaining)}` : fmtCountdown(remaining)}
        </span>
      </div>
      {step.instruction && <p className="instruction">{step.instruction}</p>}
      <div className="progress-rail">
        <div style={{ width: `${fraction * 100}%`, background: hue.service }} />
      </div>
      <div className="card-actions">
        <Button appearance="primary" onClick={onDone}>
          Done
        </Button>
        <Button appearance="secondary" onClick={onDelay}>
          +5 min
        </Button>
        <Button appearance="transparent" size="small" onClick={onUndo}>
          Undo start
        </Button>
      </div>
    </div>
  );
}

export default function CookPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const { state, connected, error, send } = useSession(sessionId);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (state && !plan) {
      api.getPlan(state.plan_id).then(setPlan).catch(() => undefined);
    }
  }, [state, plan]);

  const hueIndexByRecipe = useMemo(() => {
    const map = new Map<string, number>();
    if (plan) plan.recipe_ids.forEach((id, i) => map.set(id, i));
    else if (state) {
      let i = 0;
      for (const step of state.steps) {
        if (!map.has(step.recipe_id)) map.set(step.recipe_id, i++);
      }
    }
    return map;
  }, [plan, state]);

  const grouped = useMemo(() => {
    if (!state) return { running: [], pending: [], doneCount: 0, total: 0 };
    const running = state.steps
      .filter((s) => s.status === 'running')
      .sort((a, b) => a.planned_end.localeCompare(b.planned_end));
    const pending = state.steps
      .filter((s) => s.status === 'pending')
      .sort((a, b) => a.planned_start.localeCompare(b.planned_start));
    const doneCount = state.steps.filter((s) => s.status === 'done').length;
    return { running, pending, doneCount, total: state.steps.length };
  }, [state]);

  const timeline = useMemo(() => {
    if (!state) return null;
    const names = new Map<string, string>();
    for (const step of state.steps) names.set(step.recipe_id, step.recipe_name);
    const order = plan?.recipe_ids ?? Array.from(names.keys());
    const tracks: TimelineTrack[] = order
      .filter((id) => names.has(id))
      .map((id) => ({
        id,
        name: names.get(id)!,
        hueIndex: hueIndexByRecipe.get(id) ?? 0,
      }));
    const blocks: TimelineBlock[] = state.steps.map((step) => ({
      id: step.step_id,
      trackId: step.recipe_id,
      name: step.name,
      start: parseIso(step.planned_start),
      end: parseIso(step.planned_end),
      attention: step.attention,
      equipment: step.equipment,
      status: step.status,
    }));
    return { tracks, blocks };
  }, [state, plan, hueIndexByRecipe]);

  if (!state) {
    return (
      <FluentProvider theme={serviceTheme} style={{ background: 'transparent' }}>
        <div className="cook-root">
          <div className="cook-header">
            <div className="cook-title">
              <span className="eyebrow">Service</span>
              <h1>{error ? `Could not open the session: ${error}` : 'Lighting the stove…'}</h1>
            </div>
          </div>
        </div>
      </FluentProvider>
    );
  }

  const pushed = state.serve_push_min > 0;
  const serveEta = parseIso(state.serve_eta);
  const finished = state.status === 'done';
  const upNext = grouped.pending.slice(0, 7);

  return (
    <FluentProvider theme={serviceTheme} style={{ background: 'transparent' }}>
      <div className="cook-root">
        <div className="cook-header">
          <div className="cook-title">
            <span className="eyebrow">
              Service · {grouped.doneCount}/{grouped.total} steps ·{' '}
              {connected ? 'live' : 'reconnecting…'}
            </span>
            <h1>{state.plan_name}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <span className="cook-clock">{fmtClock(now)}</span>
            <span className={`eta-chip ${pushed ? 'late' : 'on-time'}`}>
              {pushed ? `serve slips +${state.serve_push_min} min → ` : 'on time · '}
              {fmtClock(serveEta)}
            </span>
            <Button
              appearance="secondary"
              onClick={() => navigate(`/meals/${state.plan_id}`)}
            >
              Back to plan
            </Button>
            {!finished && (
              <Button
                appearance="subtle"
                onClick={() => {
                  if (window.confirm('End this cook session?')) send({ type: 'finish' });
                }}
              >
                End service
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 26px 0' }}>
            <WarningsBar warnings={[{ code: 'client', message: error, step_id: null }]} serviceMode />
          </div>
        )}
        {state.warnings.length > 0 && (
          <div style={{ padding: '10px 26px 0' }}>
            <WarningsBar warnings={state.warnings} serviceMode />
          </div>
        )}

        {finished ? (
          <div className="done-banner">
            <h2>Service complete</h2>
            <p style={{ color: '#a79c8c' }}>
              {grouped.total} steps, {state.plan_name} on the table.
            </p>
            <Button appearance="primary" onClick={() => navigate(`/meals/${state.plan_id}`)}>
              Back to the plan
            </Button>
          </div>
        ) : (
          <div className="cook-main">
            <section className="cook-section">
              <h2>On the fire</h2>
              <div className="cook-cards">
                {grouped.running.map((step) => (
                  <RunningCard
                    key={step.step_id}
                    step={step}
                    hueIndex={hueIndexByRecipe.get(step.recipe_id) ?? 0}
                    now={now}
                    onDone={() => send({ type: 'complete_step', step_id: step.step_id })}
                    onDelay={() => send({ type: 'delay_step', step_id: step.step_id, minutes: 5 })}
                    onUndo={() => send({ type: 'reset_step', step_id: step.step_id })}
                  />
                ))}
                {grouped.running.length === 0 && upNext.length > 0 && (
                  <p style={{ color: '#a79c8c', margin: 0 }}>
                    Nothing on the fire — start the next step when you're ready.
                  </p>
                )}
              </div>
            </section>

            <section className="cook-section">
              <h2>Coming up</h2>
              <div className="panel" style={{ background: '#211d17', borderColor: '#3a342b', padding: '4px 6px' }}>
                {upNext.map((step) => {
                  const plannedStart = parseIso(step.planned_start);
                  const minutesAway = minutesBetween(now, plannedStart);
                  const due = minutesAway <= 0;
                  const hue = hueFor(hueIndexByRecipe.get(step.recipe_id) ?? 0);
                  return (
                    <div key={step.step_id} className="next-row">
                      <span className={`when${due ? ' due' : ''}`}>
                        {due ? 'now' : minutesAway <= 90 ? `in ${minutesAway}m` : fmtClock(plannedStart)}
                      </span>
                      <span className="hue-dot" style={{ background: hue.service }} />
                      <span className="what">
                        <span className="step-name">{step.name}</span>
                        <span className="recipe-name">
                          {step.recipe_name} · {step.duration_min} min ·{' '}
                          {step.attention === 'active' ? 'hands-on' : 'unattended'}
                        </span>
                      </span>
                      <Button
                        appearance={due ? 'primary' : 'secondary'}
                        size="small"
                        onClick={() => send({ type: 'start_step', step_id: step.step_id })}
                      >
                        Fire
                      </Button>
                    </div>
                  );
                })}
                {upNext.length === 0 && (
                  <p style={{ color: '#a79c8c', padding: '10px 12px' }}>
                    Everything is fired — finish what's running.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}

        {!finished && timeline && (
          <div className="cook-footer">
            <div className="timeline-wrap service">
              <Timeline
                tracks={timeline.tracks}
                blocks={timeline.blocks}
                serveAt={parseIso(state.serve_at)}
                serveEta={serveEta}
                now={now}
                mode="service"
                compact
                showLanes={false}
              />
            </div>
          </div>
        )}
      </div>
    </FluentProvider>
  );
}
