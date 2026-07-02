import type { Warning } from '../api/types';

export function WarningsBar({
  warnings,
  serviceMode = false,
}: {
  warnings: Warning[];
  serviceMode?: boolean;
}) {
  if (warnings.length === 0) return null;
  return (
    <div className={`warning-bar${serviceMode ? ' service-mode' : ''}`} role="status">
      {warnings.map((warning, i) => (
        <span key={`${warning.code}-${warning.step_id ?? i}`}>⚠ {warning.message}</span>
      ))}
    </div>
  );
}
