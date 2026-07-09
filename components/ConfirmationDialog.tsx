import React from 'react';
import { ConfirmDialog } from './ui';

// Kept as a named wrapper so its five call sites (HoReCaAdmin, HoReCaListView,
// ProductAdmin, SupplierAdmin, UserAdmin) keep their `isOpen` prop. All five are
// delete confirmations, hence the danger tone. New code should use <ConfirmDialog>.

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
}) => (
  <ConfirmDialog
    open={isOpen}
    title={title}
    message={message}
    tone="danger"
    onConfirm={onConfirm}
    onCancel={onCancel}
  />
);

export default ConfirmationDialog;
