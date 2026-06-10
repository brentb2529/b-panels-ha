import React, { useState, useCallback, useRef, useMemo } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { deployReload } from '../services/haClient';
import { exportConfig, importConfig, ConfigImportError } from '../services/configIO';
import { getDeviceDefaultPanelId } from '../design-system/shell/usePanelDefault';
import { isPanelScoped } from '../services/panelScoping';
import {
  IconRocket, IconUpload, IconDownload, IconUsers, IconPlus, IconTrash2,
  IconLock, IconLockOpen, IconCheckCircle, IconAlertTriangle, IconRefreshCw,
} from './icons';

// Local copies of the small Admin primitives (kept identical so this drop-in
// tab matches the rest of the admin chrome without importing Admin.tsx, which
// would create a cycle).
const Section: React.FC<React.PropsWithChildren<{ title: string; description?: React.ReactNode; icon?: React.ReactNode }>> = ({ title, description, icon, children }) => (
  <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
    <h3 className="text-xl font-semibold mb-1 flex items-center gap-2">{icon}{title}</h3>
    {description && <p className="text-sm text-gray-400 mb-4">{description}</p>}
    {children}
  </div>
);

const Btn = ({ children, onClick, variant = 'primary', className = '', ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'secondary' }>) => {
  const base = 'px-4 py-2 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2';
  const v = { primary: 'bg-brand-blue text-white hover:bg-blue-500', danger: 'bg-red-600 text-white hover:bg-red-500', secondary: 'bg-gray-600 text-white hover:bg-gray-500' }[variant];
  return <button onClick={onClick} className={`${base} ${v} ${className}`} {...props}>{children}</button>;
};

// ─────────────────────────────────────────────────────────────────────────
// Deploy — save (handled by the debounced auto-save) + push reload to devices
// via the existing b_panels.command service. All panels, or one installation.
// ─────────────────────────────────────────────────────────────────────────
const DeployManager: React.FC = () => {
  const { addNotification } = useDashboard();
  const [installationId, setInstallationId] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; msg?: string; call?: any }>({ kind: 'idle' });

  const deploy = useCallback(async () => {
    setStatus({ kind: 'busy' });
    try {
      const target = installationId.trim() || undefined;
      const call = await deployReload(target);
      setStatus({ kind: 'ok', msg: target ? `Reload pushed to panel "${target}".` : 'Reload pushed to all connected panels.', call });
      addNotification('Deploy: reload command sent.', 'success');
    } catch (e: any) {
      setStatus({ kind: 'err', msg: e?.message || 'Deploy failed.' });
      addNotification('Deploy failed — see Deploy tab.', 'error');
    }
  }, [installationId, addNotification]);

  return (
    <Section
      title="Deploy"
      icon={<IconRocket className="w-5 h-5 text-brand-blue" />}
      description="Changes are saved continuously. Use Deploy to PUSH a reload to the connected iPads so they pick up the latest config immediately — all panels, or a single installation."
    >
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label htmlFor="deploy-target" className="block mb-1 text-sm font-medium text-gray-400">Target installation id (optional)</label>
            <input
              id="deploy-target"
              type="text"
              value={installationId}
              placeholder="Leave blank to reload ALL connected panels"
              onChange={(e) => setInstallationId(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue"
            />
          </div>
          <Btn onClick={deploy} disabled={status.kind === 'busy'}>
            {status.kind === 'busy' ? <IconRefreshCw className="w-4 h-4 animate-spin" /> : <IconRocket className="w-4 h-4" />}
            {installationId.trim() ? 'Deploy to panel' : 'Deploy to all panels'}
          </Btn>
        </div>

        {status.kind === 'ok' && (
          <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-md p-3 text-sm">
            <div className="flex items-center gap-2 font-medium"><IconCheckCircle className="w-4 h-4" />{status.msg}</div>
            {status.call && (
              <pre className="mt-2 text-xs text-emerald-200/80 bg-black/30 rounded p-2 overflow-x-auto">
{`service: ${status.call.domain}.${status.call.service}\ndata: ${JSON.stringify(status.call.data, null, 2)}`}
              </pre>
            )}
          </div>
        )}
        {status.kind === 'err' && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-md p-3 text-sm flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4" />{status.msg}
          </div>
        )}
        <p className="text-xs text-gray-500">
          Fires <code className="text-gray-400">b_panels.command &#123;action: 'reload'&#125;</code>. Panels that aren't connected to the command channel are simply skipped (no error).
        </p>
      </div>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Per-user panel scoping — OPTIONAL, convenience-grade. Reuses config `users`
// (the PIN profiles). A panel is OPEN unless an admin adds it to one or more
// users' allow-lists (panel.visibleToUsers). Default stays open/unrestricted.
// ─────────────────────────────────────────────────────────────────────────
const PanelScopingManager: React.FC = () => {
  const { panels, users, addUser, removeUser, updatePanelConfig } = useDashboard();
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');

  const deviceDefault = getDeviceDefaultPanelId();

  const togglePanelUser = useCallback((panelId: string, userId: string) => {
    const panel = panels.find((p) => p.id === panelId);
    if (!panel) return;
    const cur = new Set(panel.visibleToUsers ?? []);
    if (cur.has(userId)) cur.delete(userId); else cur.add(userId);
    const next = Array.from(cur);
    // Empty array => fully open again; store undefined so the panel reads as
    // unscoped (additive/non-breaking with every legacy panel).
    updatePanelConfig(panelId, { visibleToUsers: next.length ? next : undefined });
  }, [panels, updatePanelConfig]);

  const addProfile = useCallback(() => {
    const name = newName.trim();
    const pin = newPin.trim();
    if (!name || pin.length < 4) return;
    addUser(name, pin);
    setNewName(''); setNewPin('');
  }, [newName, newPin, addUser]);

  return (
    <Section
      title="Per-User Panel Scoping (optional)"
      icon={<IconLock className="w-5 h-5 text-amber-400" />}
      description={
        <>
          <b>Panels are OPEN by default.</b> Most panels are trusted, full-house views that anyone can reach with no PIN —
          they land on this device's curated default and return there when idle. Scoping is an <b>optional</b> layer for the
          few panels that should be gated (e.g. a guest-house iPad's landing that shouldn't reach the pool): tick the
          profiles allowed to switch to a panel and everyone else gets a PIN prompt.
        </>
      }
    >
      {/* Honesty banner — the user accepted this trade-off. */}
      <div className="bg-amber-500/10 border border-amber-500/40 text-amber-200 rounded-md p-3 text-sm mb-5 flex gap-2">
        <IconAlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          This is <b>convenience-grade UI scoping, not a tamper-proof security boundary</b> — a motivated user could reach
          a route directly. A <b>life-safety takeover always overrides scoping</b> (fire / CO / intrusion annunciations
          render above every panel and PIN gate). A device's own default panel is always open on that device.
        </span>
      </div>

      {/* Access profiles (PINs) */}
      <h4 className="font-semibold text-gray-200 mb-2 flex items-center gap-2"><IconUsers className="w-4 h-4" />Access profiles</h4>
      <div className="space-y-2 mb-4">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between bg-gray-700 p-3 rounded-md">
            <span className="font-medium text-gray-100">{u.name}</span>
            <Btn variant="danger" className="!px-3 !py-1 text-sm" onClick={() => removeUser(u.id)} disabled={users.length <= 1} title={users.length <= 1 ? 'Cannot remove the last profile' : 'Remove profile'}>
              <IconTrash2 className="w-4 h-4" />
            </Btn>
          </div>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mb-8">
        <input type="text" value={newName} placeholder="Profile name (e.g. Guest)" onChange={(e) => setNewName(e.target.value)} className="flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-white" />
        <input type="password" inputMode="numeric" value={newPin} placeholder="PIN (4+ digits)" onChange={(e) => setNewPin(e.target.value)} className="sm:w-44 bg-gray-700 border border-gray-600 rounded-md p-2 text-white" />
        <Btn onClick={addProfile} disabled={!newName.trim() || newPin.trim().length < 4}><IconPlus className="w-4 h-4" />Add profile</Btn>
      </div>

      {/* Per-panel scoping matrix */}
      <h4 className="font-semibold text-gray-200 mb-2">Panel access</h4>
      <div className="space-y-2">
        {panels.map((p) => {
          const scoped = isPanelScoped(p);
          const isDefault = deviceDefault === p.id;
          return (
            <div key={p.id} className="bg-gray-700/60 border border-gray-600 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                {scoped ? <IconLock className="w-4 h-4 text-amber-400" /> : <IconLockOpen className="w-4 h-4 text-emerald-400" />}
                <span className="font-medium text-gray-100">{p.name}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded border ${scoped ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'}`}>
                  {scoped ? 'Scoped' : 'Open'}
                </span>
                {isDefault && <span className="text-xs px-2 py-0.5 rounded border bg-sky-500/15 text-sky-300 border-sky-500/40" title="This device's curated default — always open on this device">This device's home</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {users.map((u) => {
                  const allowed = (p.visibleToUsers ?? []).includes(u.id);
                  return (
                    <button
                      key={u.id}
                      onClick={() => togglePanelUser(p.id, u.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${allowed ? 'bg-brand-blue/20 text-brand-blue border-brand-blue/50' : 'bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-500'}`}
                      title={allowed ? `${u.name} may open this panel` : `Tap to allow ${u.name}`}
                    >
                      {allowed ? '✓ ' : ''}{u.name}
                    </button>
                  );
                })}
                {users.length === 0 && <span className="text-xs text-gray-500">Add a profile above to scope this panel.</span>}
              </div>
              {scoped && (
                <p className="text-xs text-gray-500 mt-2">
                  Switching to this panel prompts for a PIN unless an allowed profile is already unlocked this session (or this is the device's own default).
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Config export / import — JSON file round-trip, secret-stripped, migrated.
// ─────────────────────────────────────────────────────────────────────────
const ConfigIOManager: React.FC = () => {
  const { config, replaceConfig, addNotification } = useDashboard();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const doExport = useCallback(() => {
    const payload = exportConfig(config);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `b-panels-config-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    addNotification('Config exported.', 'success');
  }, [config, addNotification]);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    setImportMsg(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const { config: next, summary } = importConfig(raw, config);
      replaceConfig(next);
      const parts = [
        `${summary.panels} panel${summary.panels === 1 ? '' : 's'}`,
        `schema ${summary.fromSchema} → ${summary.toSchema}`,
      ];
      if (summary.tilesMigrated) parts.push(`${summary.tilesMigrated} tile(s) migrated`);
      if (summary.secretsStripped) parts.push(`${summary.secretsStripped} secret field(s) stripped`);
      setImportMsg({ kind: 'ok', msg: `Imported: ${parts.join(' · ')}. Saving…` });
      addNotification('Config imported and applied.', 'success');
    } catch (err: any) {
      const msg = err instanceof ConfigImportError ? err.message
        : (err instanceof SyntaxError ? 'That file is not valid JSON.' : (err?.message || 'Import failed.'));
      setImportMsg({ kind: 'err', msg });
      addNotification('Config import failed.', 'error');
    }
  }, [config, replaceConfig, addNotification]);

  return (
    <Section
      title="Config Export / Import"
      icon={<IconDownload className="w-5 h-5 text-brand-blue" />}
      description="Back up the whole dashboard config to a JSON file, or restore one. Exports never contain secrets (any stray credential is stripped). Imports are migrated to the current schema and refuse to wipe a populated dashboard."
    >
      <div className="flex flex-wrap gap-3">
        <Btn variant="secondary" onClick={doExport}><IconDownload className="w-4 h-4" />Export config</Btn>
        <Btn variant="secondary" onClick={() => fileRef.current?.click()}><IconUpload className="w-4 h-4" />Import config…</Btn>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
      </div>
      {importMsg && (
        <div className={`mt-4 rounded-md p-3 text-sm flex items-center gap-2 ${importMsg.kind === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-300' : 'bg-red-500/10 border border-red-500/40 text-red-300'}`}>
          {importMsg.kind === 'ok' ? <IconCheckCircle className="w-4 h-4" /> : <IconAlertTriangle className="w-4 h-4" />}
          {importMsg.msg}
        </div>
      )}
    </Section>
  );
};

const AdminDeploy: React.FC = () => (
  <>
    <DeployManager />
    <PanelScopingManager />
    <ConfigIOManager />
  </>
);

export default AdminDeploy;
