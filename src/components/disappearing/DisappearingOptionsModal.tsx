import React, { useState } from 'react';
import { Eye, Clock, X, Check, ShieldAlert, Sparkles } from 'lucide-react';
import { MessageMode } from '../../types';

export interface DisappearingSettings {
  mode: MessageMode;
  durationSeconds?: number | null; // For auto-delete mode
}

interface DisappearingOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: DisappearingSettings;
  onSave: (settings: DisappearingSettings) => void;
}

const PRESET_DURATIONS = [
  { label: '5 seconds', seconds: 5 },
  { label: '10 seconds', seconds: 10 },
  { label: '15 seconds', seconds: 15 },
  { label: '20 seconds', seconds: 20 },
  { label: '30 seconds', seconds: 30 },
  { label: '45 seconds', seconds: 45 },
  { label: '1 minute', seconds: 60 },
  { label: '2 minutes', seconds: 120 },
  { label: '3 minutes', seconds: 180 },
  { label: '5 minutes', seconds: 300 },
  { label: '10 minutes', seconds: 600 },
  { label: '30 minutes', seconds: 1800 },
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '12 hours', seconds: 43200 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
];

export const DisappearingOptionsModal: React.FC<DisappearingOptionsModalProps> = ({
  isOpen,
  onClose,
  currentSettings,
  onSave,
}) => {
  const [selectedMode, setSelectedMode] = useState<MessageMode>(currentSettings.mode || 'normal');
  const [selectedSeconds, setSelectedSeconds] = useState<number>(currentSettings.durationSeconds || 300);
  const [isCustom, setIsCustom] = useState<boolean>(
    currentSettings.mode === 'auto_delete' &&
    !PRESET_DURATIONS.some(p => p.seconds === currentSettings.durationSeconds)
  );

  // Custom inputs
  const [customValue, setCustomValue] = useState<string>('15');
  const [customUnit, setCustomUnit] = useState<'seconds' | 'minutes' | 'hours' | 'days'>('seconds');
  const [customError, setCustomError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleApplyCustom = () => {
    const val = parseInt(customValue, 10);
    if (isNaN(val) || val <= 0) {
      setCustomError('Please enter a valid positive number');
      return;
    }

    let multiplier = 1; // seconds
    if (customUnit === 'minutes') multiplier = 60;
    if (customUnit === 'hours') multiplier = 3600;
    if (customUnit === 'days') multiplier = 86400;

    const totalSeconds = val * multiplier;
    if (totalSeconds > 31536000) { // Max 1 year
      setCustomError('Maximum duration is 365 days');
      return;
    }

    setCustomError(null);
    setSelectedSeconds(totalSeconds);
    setIsCustom(false);
  };

  const handleSave = () => {
    if (selectedMode === 'normal') {
      onSave({ mode: 'normal', durationSeconds: null });
    } else if (selectedMode === 'view_once') {
      onSave({ mode: 'view_once', durationSeconds: null });
    } else if (selectedMode === 'auto_delete') {
      onSave({ mode: 'auto_delete', durationSeconds: selectedSeconds });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div 
        className="bg-[#111b21] border border-gray-800 text-gray-200 rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 shadow-2xl relative space-y-5 max-h-[90vh] overflow-y-auto scrollbar-thin"
        id="disappearing-options-modal"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Text Disappearing Options</h3>
              <p className="text-[11px] text-gray-400">WhatsApp-style view once & self-destruct messages</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 hover:bg-gray-800/60 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-3 gap-2">
          {/* Off / Normal */}
          <button
            type="button"
            onClick={() => {
              setSelectedMode('normal');
              setIsCustom(false);
            }}
            className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
              selectedMode === 'normal'
                ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-md'
                : 'bg-[#202c33] border-gray-800 text-gray-400 hover:bg-gray-800/50'
            }`}
          >
            <X className="w-5 h-5" />
            <span className="text-xs font-bold">Off</span>
            <span className="text-[9px] text-gray-400">Normal Chat</span>
          </button>

          {/* View Once */}
          <button
            type="button"
            onClick={() => {
              setSelectedMode('view_once');
              setIsCustom(false);
            }}
            className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
              selectedMode === 'view_once'
                ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-md'
                : 'bg-[#202c33] border-gray-800 text-gray-400 hover:bg-gray-800/50'
            }`}
          >
            <Eye className="w-5 h-5" />
            <span className="text-xs font-bold">View Once</span>
            <span className="text-[9px] text-gray-400">Opens 1 time</span>
          </button>

          {/* Auto Delete */}
          <button
            type="button"
            onClick={() => setSelectedMode('auto_delete')}
            className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
              selectedMode === 'auto_delete'
                ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-md'
                : 'bg-[#202c33] border-gray-800 text-gray-400 hover:bg-gray-800/50'
            }`}
          >
            <Clock className="w-5 h-5" />
            <span className="text-xs font-bold">Auto Delete</span>
            <span className="text-[9px] text-gray-400">Timer countdown</span>
          </button>
        </div>

        {/* View Once Info */}
        {selectedMode === 'view_once' && (
          <div className="p-4 bg-emerald-950/30 border border-emerald-500/20 rounded-2xl space-y-2 text-xs text-emerald-300">
            <div className="flex items-center gap-2 font-bold text-emerald-400">
              <Eye className="w-4 h-4" /> View Once Text Message
            </div>
            <p className="leading-relaxed text-[11px] text-gray-300">
              For added privacy, the next text message can only be opened <b>ONCE</b> by the recipient. Once opened or closed, it disappears permanently from both sides.
            </p>
            <p className="text-[10px] text-gray-400 font-mono">
              🛡️ Screenshot protection overlay active during viewing.
            </p>
          </div>
        )}

        {/* Auto Delete Preset Picker */}
        {selectedMode === 'auto_delete' && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span className="font-semibold text-white">Select Disappearing Timer:</span>
              <button
                type="button"
                onClick={() => setIsCustom(!isCustom)}
                className="text-emerald-400 hover:underline font-bold text-[11px] cursor-pointer"
              >
                {isCustom ? 'Show Presets' : '✏️ Custom Timer'}
              </button>
            </div>

            {isCustom ? (
              <div className="p-3 bg-[#202c33] border border-gray-800 rounded-2xl space-y-3">
                <div className="text-xs font-semibold text-gray-200">Set Custom Duration:</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    placeholder="Duration"
                    className="flex-1 bg-[#111b21] border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                  <select
                    value={customUnit}
                    onChange={(e: any) => setCustomUnit(e.target.value)}
                    className="bg-[#111b21] border border-gray-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="seconds">Seconds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>

                {customError && (
                  <p className="text-[10px] text-rose-400 font-medium">{customError}</p>
                )}

                <button
                  type="button"
                  onClick={handleApplyCustom}
                  className="w-full py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Apply Custom Duration
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[180px] overflow-y-auto scrollbar-thin pr-1">
                {PRESET_DURATIONS.map((preset) => {
                  const isSelected = selectedSeconds === preset.seconds;
                  return (
                    <button
                      key={preset.seconds}
                      type="button"
                      onClick={() => setSelectedSeconds(preset.seconds)}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 font-bold'
                          : 'bg-[#202c33] border-gray-800 text-gray-300 hover:bg-gray-800/50'
                      }`}
                    >
                      <span>{preset.label}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Modal Actions */}
        <div className="pt-3 border-t border-gray-800/80 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-lg shadow-emerald-500/10"
          >
            Apply Mode
          </button>
        </div>
      </div>
    </div>
  );
};
