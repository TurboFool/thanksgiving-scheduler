import React, { useState } from 'react';
import { X, Settings, Volume2, Bell, KeyRound, Clock } from 'lucide-react';
import type { AppSettings } from '../types';
import { soundManager } from '../audio';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendBrowserNotification,
} from '../notifications';

interface SettingsModalProps {
  settings: AppSettings;
  simulatedNowMin: number;
  simTimeOverridden?: boolean;
  onSave: (
    nextSettings: AppSettings,
    nextSimulatedNowMin?: number,
    nextSimTimeOverridden?: boolean
  ) => void;
  onClose: () => void;
}

function minToTimeInput(min: number): string {
  const norm = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function timeInputToMin(val: string, fallback: number): number {
  const [h, m] = val.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback;
  return h * 60 + m;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  simulatedNowMin,
  simTimeOverridden = false,
  onSave,
  onClose,
}) => {
  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey);
  const [syncPasscode, setSyncPasscode] = useState(settings.syncPasscode);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [voiceEnabled, setVoiceEnabled] = useState(settings.voiceEnabled);
  const [warningAt5Min, setWarningAt5Min] = useState(settings.warningAt5Min);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(
    settings.browserNotificationsEnabled !== false
  );
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());
  const [useSimulatedClock, setUseSimulatedClock] = useState(settings.useSimulatedClock);
  const [simMin, setSimMin] = useState(simulatedNowMin);
  const [simOverridden, setSimOverridden] = useState(simTimeOverridden);
  const [voiceTestStatus, setVoiceTestStatus] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(
      {
        ...settings,
        geminiApiKey: geminiApiKey.trim(),
        syncPasscode: syncPasscode.trim(),
        soundEnabled,
        voiceEnabled,
        warningAt5Min,
        browserNotificationsEnabled,
        useSimulatedClock,
        simulatedNowMin: simMin,
      },
      simMin,
      simOverridden
    );
    onClose();
  };

  const handleTestVoice = () => {
    soundManager.unlock();
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoiceTestStatus('Speech synthesis is not supported in this browser.');
      return;
    }
    soundManager.speak('ThymeLine voice notifications are ready for the kitchen.');
    setVoiceTestStatus('Spoke test announcement.');
    setTimeout(() => setVoiceTestStatus(null), 2500);
  };

  const handleTestNotification = async () => {
    let perm = getNotificationPermission();
    if (perm === 'default') {
      perm = await requestNotificationPermission();
      setNotifPermission(perm);
    }
    if (perm === 'unsupported') {
      setVoiceTestStatus('Browser notifications are not supported here.');
      return;
    }
    if (perm === 'denied') {
      setVoiceTestStatus('Notifications are blocked in browser site settings.');
      return;
    }
    sendBrowserNotification('ThymeLine Kitchen Alert', {
      body: 'Browser notifications are enabled for timers, due steps, and Gemini replies.',
      tag: 'thymeline-test',
      force: true,
    });
    setVoiceTestStatus('Sent test browser notification.');
    setTimeout(() => setVoiceTestStatus(null), 2500);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={18} color="var(--accent-sage)" />
            ThymeLine Settings
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* API & Cloud Sync Credentials */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="section-label">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <KeyRound size={12} /> API &amp; Cloud Sync Credentials
                </span>
              </div>

              <div className="form-field">
                <label htmlFor="settings-gemini-key">
                  Gemini API Key (stored locally in your browser)
                </label>
                <input
                  id="settings-gemini-key"
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIza..."
                />
              </div>

              <div className="form-field">
                <label htmlFor="settings-sync-passcode">
                  Family Cloud Sync Passcode (matches Cloudflare Pages SYNC_PASSCODE)
                </label>
                <input
                  id="settings-sync-passcode"
                  type="password"
                  value={syncPasscode}
                  onChange={(e) => setSyncPasscode(e.target.value)}
                  placeholder="Shared family passcode"
                />
              </div>
            </div>

            {/* Audio & Voice Notifications */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="section-label">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Volume2 size={12} /> Audio &amp; Voice Notifications
                </span>
              </div>

              <label className="dep-check-item">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                />
                <span>Audible alarm bell when timers finish</span>
              </label>

              <label className="dep-check-item">
                <input
                  type="checkbox"
                  checked={warningAt5Min}
                  onChange={(e) => setWarningAt5Min(e.target.checked)}
                />
                <span>Gentle 5-minute warning chime before timer finishes</span>
              </label>

              <label className="dep-check-item">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                />
                <span>Spoken voice announcements (Web Speech API)</span>
              </label>

              <label className="dep-check-item">
                <input
                  type="checkbox"
                  checked={browserNotificationsEnabled}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setBrowserNotificationsEnabled(checked);
                    if (checked && getNotificationPermission() === 'default') {
                      const perm = await requestNotificationPermission();
                      setNotifPermission(perm);
                    }
                  }}
                />
                <span>
                  Browser notifications (timers, due steps, cloud updates &amp; Gemini responses)
                  {notifPermission === 'granted' && ' · Granted'}
                  {notifPermission === 'denied' && ' · Blocked in browser settings'}
                  {notifPermission === 'default' && ' · Click Test to grant'}
                </span>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    soundManager.unlock();
                    soundManager.playAlarmBell();
                  }}
                >
                  <Bell size={14} /> Test Bell
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleTestVoice}>
                  <Volume2 size={14} /> Test Voice
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleTestNotification}>
                  <Bell size={14} /> Test Notification
                </button>
                {voiceTestStatus && (
                  <span style={{ fontSize: '0.76rem', color: 'var(--accent-sage)' }}>
                    {voiceTestStatus}
                  </span>
                )}
              </div>
            </div>

            {/* Planning vs Execution Mode */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="section-label">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={12} /> Planning vs. Execution Mode
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`btn ${useSimulatedClock ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setUseSimulatedClock(true)}
                >
                  Planning Mode (Ahead of Time)
                </button>
                <button
                  type="button"
                  className={`btn ${!useSimulatedClock ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setUseSimulatedClock(false)}
                >
                  Execution Mode (Day-Of Live)
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--ink-muted)' }}>
                {useSimulatedClock
                  ? 'Planning Mode is independent of your real-world clock and defaults to the suggested start time for your chosen dishes.'
                  : 'Execution Mode uses your live real-world clock for day-of timers, alarms, and real-time cascading.'}
              </p>

              {useSimulatedClock && (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                  <div className="form-field" style={{ maxWidth: 200 }}>
                    <label htmlFor="settings-sim-time">
                      Simulated Start Time {simOverridden ? '(Custom)' : '(Auto — Suggested Start)'}
                    </label>
                    <input
                      id="settings-sim-time"
                      type="time"
                      value={minToTimeInput(simMin)}
                      onChange={(e) => {
                        setSimMin(timeInputToMin(e.target.value, simMin));
                        setSimOverridden(true);
                      }}
                    />
                  </div>
                  {simOverridden && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '6px 10px' }}
                      onClick={() => setSimOverridden(false)}
                    >
                      Reset to Suggested Start
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
              <strong className="mono">ThymeLine v{__APP_VERSION__}</strong> · Credentials stay in
              your browser localStorage.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
