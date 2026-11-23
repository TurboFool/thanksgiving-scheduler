import React, { useState } from 'react';
import { X, Settings, Volume2, Bell, KeyRound, Clock } from 'lucide-react';
import type { AppSettings } from '../types';
import { soundManager } from '../audio';

interface SettingsModalProps {
  settings: AppSettings;
  simulatedNowMin: number;
  onSave: (nextSettings: AppSettings, nextSimulatedNowMin?: number) => void;
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
  onSave,
  onClose,
}) => {
  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey);
  const [syncPasscode, setSyncPasscode] = useState(settings.syncPasscode);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [voiceEnabled, setVoiceEnabled] = useState(settings.voiceEnabled);
  const [warningAt5Min, setWarningAt5Min] = useState(settings.warningAt5Min);
  const [useSimulatedClock, setUseSimulatedClock] = useState(settings.useSimulatedClock);
  const [simMin, setSimMin] = useState(simulatedNowMin);
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
        useSimulatedClock,
        simulatedNowMin: simMin,
      },
      simMin
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
                {voiceTestStatus && (
                  <span style={{ fontSize: '0.76rem', color: 'var(--accent-sage)' }}>
                    {voiceTestStatus}
                  </span>
                )}
              </div>
            </div>

            {/* Clock & Rehearsal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="section-label">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={12} /> Clock &amp; Rehearsal Mode
                </span>
              </div>

              <label className="dep-check-item">
                <input
                  type="checkbox"
                  checked={useSimulatedClock}
                  onChange={(e) => setUseSimulatedClock(e.target.checked)}
                />
                <span>Use Simulated Clock (for testing &amp; rehearsing schedules)</span>
              </label>

              {useSimulatedClock && (
                <div className="form-field" style={{ maxWidth: 200 }}>
                  <label htmlFor="settings-sim-time">Simulated Current Time</label>
                  <input
                    id="settings-sim-time"
                    type="time"
                    value={minToTimeInput(simMin)}
                    onChange={(e) => setSimMin(timeInputToMin(e.target.value, simMin))}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
              Credentials stay in your browser localStorage.
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
