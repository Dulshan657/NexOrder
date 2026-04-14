import React from 'react';

interface MobileCheckoutButtonProps {
  itemCount: number;
  onClick: () => void;
}

const MobileCheckoutButton: React.FC<MobileCheckoutButtonProps> = ({ itemCount, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="lg:hidden fixed bottom-4 right-4 bg-nexgen-blue text-white rounded-full shadow-elevated p-4 flex items-center justify-center z-30 hover:bg-nexgen-blue-dark transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-nexgen-blue cursor-pointer"
      aria-label={`View your order, ${itemCount} items`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
      {itemCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center border-2 border-white">
          {itemCount}
        </span>
      )}
    </button>
  );
};

export default MobileCheckoutButton;
