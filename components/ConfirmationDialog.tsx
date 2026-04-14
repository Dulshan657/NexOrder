import React from 'react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-stone-200">
        <h2 id="dialog-title" className="text-xl font-display font-bold text-stone-900">{title}</h2>
        <p className="text-stone-600 mt-2">{message}</p>
        <div className="mt-6 flex justify-end space-x-3 pt-4 border-t border-stone-100">
          <button
            type="button"
            onClick={onCancel}
            className="bg-white py-2.5 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex justify-center py-2.5 px-5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationDialog;
