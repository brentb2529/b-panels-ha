
import React, { useState } from 'react';
import Modal from './Modal';

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional action-specific verbs (default Cancel / Confirm). */
  confirmLabel?: string;
  cancelLabel?: string;
}

const ConfirmModal = ({ message, onConfirm, onCancel, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }: ConfirmModalProps) => {
  const [pending, setPending] = useState(false);

  const handleConfirm = () => {
    if (pending) return;          // guard against double-tap on a slow action
    setPending(true);
    onConfirm();
  };

  return (
    <Modal title="Confirmation" onClose={onCancel} size="sm">
      <p className="text-gray-300 mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={pending}
          className="bg-gray-600 text-white font-bold py-2.5 px-5 rounded-control hover:bg-gray-500 active:scale-[0.97] transition-all disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          onClick={handleConfirm}
          disabled={pending}
          className="bg-brand-blue text-white font-bold py-2.5 px-5 rounded-control hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-60"
        >
          {pending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
