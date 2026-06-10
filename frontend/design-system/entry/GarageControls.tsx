import React, { useState } from 'react';
import type { GarageView } from './entry';
import './entry.css';

// ---------------------------------------------------------------------------
// GarageControls — shared garage affordances (feat/doorbell-garage · Top-10 #5).
//
// DISPLAY + NOTIFY/LOG ONLY · NO LIVE ACTUATION. There is NO callService import
// in this module, by construction. The close control is CONFIRM-TO-CLOSE gated:
// it walks rest → confirm → noted in LOCAL state and fires NOTHING (ratgdo /
// Matter not in dev; equipment-gated → human-enable only). NEVER auto-closes,
// NEVER closes on a person. The proactive alert strip is display/notify only.
// ---------------------------------------------------------------------------

const LockGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);
const ChevronDown = () => (
  <svg width="11" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
);

// The confirm-to-close affordance. `open` drives the resting label; pressing it
// reveals a stern confirm whose "Close" wires NOTHING.
export const GarageConfirmClose = ({
  doorName,
  open,
}: { doorName: string; open: boolean }) => {
  const [phase, setPhase] = useState<'rest' | 'confirm' | 'noted'>('rest');

  // Only an OPEN/moving door offers a close affordance; a closed one shows status.
  if (!open) {
    return (
      <div className="gce-close-cta" aria-disabled="true" title="Garage closed" style={{ opacity: 0.7, cursor: 'default' }}>
        <LockGlyph /> Closed
      </div>
    );
  }

  return (
    <div className="gce-confirm-wrap">
      {phase === 'rest' && (
        <button
          type="button"
          className="gce-close-cta"
          title="Confirm-to-close · equipment gated · never auto-closes, never on a person"
          onClick={() => setPhase('confirm')}
        >
          <ChevronDown /> Close…
        </button>
      )}
      {phase === 'confirm' && (
        <div className="gce-confirm">
          <div className="gce-confirm-detail">
            Close the {doorName.toLowerCase()}? Check the doorway is clear — this is
            confirm-to-close, never automatic and never on a person. Equipment gated:
            no actuation fires here.
          </div>
          <div className="gce-confirm-row">
            <button type="button" className="gce-btn ghost" onClick={() => setPhase('rest')}>Cancel</button>
            {/* GATED: render only — wires NO cover.close_cover service. */}
            <button type="button" className="gce-btn" onClick={() => setPhase('noted')}>Confirm close</button>
          </div>
        </div>
      )}
      {phase === 'noted' && (
        <div className="gce-noted"><LockGlyph /> Noted — close is gated · no service fired · live control pending approval.</div>
      )}
    </div>
  );
};

const AlertGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// The proactive garage-open alert strip (calm; display/notify only). Renders
// nothing when there are no active alerts.
export const GarageAlertStrip = ({ garage }: { garage: GarageView }) => {
  if (garage.alerts.length === 0) return null;
  return (
    <div className="gce-alert-strip" role="status" aria-live="polite">
      {garage.alerts.map((a) => (
        <div className="gce-alert-row" key={`${a.kind}-${a.doorId}`}>
          <span className="gce-alert-ico" aria-hidden><AlertGlyph /></span>
          <span className="gce-alert-text">{a.text}</span>
          <span className="gce-alert-tag">{a.kind === 'open-armed-away' ? 'Armed Away' : 'Night'}</span>
        </div>
      ))}
    </div>
  );
};
