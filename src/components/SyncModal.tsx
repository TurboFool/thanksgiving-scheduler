import React, { useState } from 'react';
import { X, Cloud, CloudDownload, CloudUpload, AlertTriangle, Check } from 'lucide-react';
import type { ThymeLineWorkspace } from '../types';
import { pullCloudWorkspace, pushCloudWorkspace } from '../sync';

interface SyncModalProps {
  workspace: ThymeLineWorkspace;
  passcode: string;
  onSavePasscode: (passcode: string) => void;
  onApplyRemoteWorkspace: (remote: ThymeLineWorkspace) => void;
  onMarkSynced: (syncVersion: number, updatedAt: number) => void;
  onClose: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  workspace,
  passcode,
  onSavePasscode,
  onApplyRemoteWorkspace,
  onMarkSynced,
  onClose,
}) => {
  const [localPasscode, setLocalPasscode] = useState(passcode);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictRemote, setConflictRemote] = useState<ThymeLineWorkspace | null>(null);

  const handlePull = async () => {
    setError(null);
    setStatusMsg(null);
    setConflictRemote(null);
    if (!localPasscode.trim()) {
      setError('Enter your family sync passcode first.');
      return;
    }
    onSavePasscode(localPasscode.trim());
    setLoading(true);
    try {
      const res = await pullCloudWorkspace(localPasscode);
      if (!res.exists || !res.workspace) {
        setStatusMsg('No cloud backup exists yet. Click "Save to Cloud" to create one.');
        return;
      }
      if (res.syncVersion === workspace.syncVersion) {
        setStatusMsg(`Already up to date (v${res.syncVersion}).`);
        return;
      }
      onApplyRemoteWorkspace(res.workspace);
      setStatusMsg(
        `Checked in cloud updates (v${res.syncVersion}, ${res.workspace.events.length} event(s)).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check in from cloud.');
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async (force = false) => {
    setError(null);
    setStatusMsg(null);
    setConflictRemote(null);
    if (!localPasscode.trim()) {
      setError('Enter your family sync passcode first.');
      return;
    }
    onSavePasscode(localPasscode.trim());
    setLoading(true);
    try {
      const res = await pushCloudWorkspace(localPasscode, workspace, force);
      if (res.conflict && res.remoteWorkspace) {
        setConflictRemote(res.remoteWorkspace);
        setError(
          `Another device saved newer changes (Cloud v${res.syncVersion} vs your v${workspace.syncVersion}). Choose how to resolve:`
        );
        return;
      }
      if (res.ok && res.syncVersion !== undefined && res.updatedAt !== undefined) {
        onMarkSynced(res.syncVersion, res.updatedAt);
        setStatusMsg(`Saved to cloud (v${res.syncVersion}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save to cloud.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cloud size={18} color="var(--accent-sage)" />
            Cloud Sync &amp; Multi-User Backup
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
            Sync your events, meal items, and reusable library to Cloudflare R2/KV so family
            members can collaborate across devices while keeping localStorage cached offline.
          </p>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-canvas)',
              border: '1px solid var(--border-light)',
              fontSize: '0.78rem',
            }}
          >
            <span>
              Local Version: <strong className="mono">v{workspace.syncVersion}</strong>
            </span>
            <span style={{ color: 'var(--ink-muted)' }}>
              {workspace.events.length} event(s) · {workspace.mealLibrary.length} library dish(es)
            </span>
          </div>

          <div className="form-field">
            <label htmlFor="sync-passcode">Shared Family Sync Passcode</label>
            <input
              id="sync-passcode"
              type="password"
              value={localPasscode}
              onChange={(e) => setLocalPasscode(e.target.value)}
              placeholder="Matches SYNC_PASSCODE in Cloudflare Pages"
            />
          </div>

          {error && (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-crimson-soft)',
                color: 'var(--status-crimson)',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {statusMsg && (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-sage-soft)',
                color: 'var(--status-sage)',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Check size={15} /> {statusMsg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePull}
              disabled={loading}
            >
              <CloudDownload size={14} /> Check In (Pull from Cloud)
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handlePush(false)}
              disabled={loading}
            >
              <CloudUpload size={14} /> Save to Cloud (Push)
            </button>
          </div>

          {conflictRemote && (
            <div
              style={{
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-amber-soft)',
                border: '1px solid var(--status-amber)',
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onApplyRemoteWorkspace(conflictRemote);
                  setConflictRemote(null);
                  setError(null);
                  setStatusMsg(`Loaded Cloud v${conflictRemote.syncVersion}.`);
                }}
              >
                Use Cloud Version (v{conflictRemote.syncVersion})
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handlePush(true)}
              >
                Overwrite Cloud with Mine
              </button>
            </div>
          )}

          <details style={{ fontSize: '0.76rem', color: 'var(--ink-muted)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              Cloudflare Pages Free Setup Guide
            </summary>
            <ol style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 1.5 }}>
              <li>
                In Cloudflare Pages → <strong>Settings → Environment Variables</strong>, add{' '}
                <code>SYNC_PASSCODE</code>.
              </li>
              <li>
                In <strong>Settings → Functions → Bindings</strong>, bind either an R2 Bucket named{' '}
                <code>THYMELINE_BUCKET</code> or a KV Namespace named <code>THYMELINE_KV</code>.
              </li>
            </ol>
          </details>
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            Local cache always stays active for offline cooking.
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
