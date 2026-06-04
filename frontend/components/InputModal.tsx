import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal';

interface InputModalProps {
  message: string;
  initialValue?: string;
  type?: 'text' | 'password' | 'number';
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const InputModal = ({ message, initialValue = '', type = 'text', onConfirm, onCancel }: InputModalProps) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <Modal title="Input Required" onClose={onCancel} size="sm" zClassName="z-[60]">
      <form onSubmit={handleSubmit}>
        <label htmlFor="input-modal-field" className="text-gray-300 mb-2 block">{message}</label>
        <input
          id="input-modal-field"
          ref={inputRef}
          type={type}
          value={value}
          onChange={e => setValue(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-white rounded-control p-2.5 w-full mb-6 focus:outline-none focus:ring-2 focus:ring-brand-blue/50"
          required
        />
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="bg-gray-600 text-white font-bold py-2.5 px-5 rounded-control hover:bg-gray-500 active:scale-[0.97] transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bg-brand-blue text-white font-bold py-2.5 px-5 rounded-control hover:brightness-110 active:scale-[0.97] transition-all"
          >
            Confirm
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default InputModal;
