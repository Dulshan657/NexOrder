import React, { useState, useCallback, type ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';

export type IconAnimation = 'spin' | 'bounce' | 'shake' | 'pulse' | 'ring' | 'pop';

interface AnimatedIconProps extends Omit<ComponentProps<LucideIcon>, 'ref'> {
  icon: LucideIcon;
  animation?: IconAnimation;
  onClick?: (e: React.MouseEvent) => void;
}

/** Default animation per icon name — extend as needed. */
const DEFAULT_ANIMATIONS: Record<string, IconAnimation> = {
  RefreshCw: 'spin',
  RotateCcw: 'spin',
  Search: 'pulse',
  Bell: 'ring',
  Heart: 'pop',
  Trash2: 'shake',
  Check: 'bounce',
  CheckCircle: 'bounce',
  CheckCircle2: 'bounce',
  Plus: 'pop',
  Minus: 'pop',
  ShoppingCart: 'bounce',
  ShoppingBag: 'bounce',
  Download: 'bounce',
  Copy: 'pop',
  Settings: 'spin',
  X: 'pop',
  XCircle: 'shake',
  AlertCircle: 'shake',
  AlertTriangle: 'shake',
  Star: 'pop',
  Play: 'pulse',
  Eye: 'pulse',
  Pencil: 'pop',
  PenLine: 'pop',
  ArrowLeft: 'pop',
  ArrowRight: 'pop',
  Package: 'bounce',
  Truck: 'bounce',
  Gift: 'shake',
  Target: 'pulse',
  Info: 'pulse',
};

function AnimatedIcon({ icon: Icon, animation, onClick, className = '', ...props }: AnimatedIconProps) {
  const [animating, setAnimating] = useState(false);

  const resolvedAnimation = animation ?? DEFAULT_ANIMATIONS[Icon.displayName ?? ''] ?? 'pop';

  const handleClick = useCallback((e: React.MouseEvent) => {
    setAnimating(true);
    onClick?.(e);
  }, [onClick]);

  const handleAnimationEnd = useCallback(() => {
    setAnimating(false);
  }, []);

  return (
    <Icon
      {...props}
      className={`${className} ${animating ? `animate-icon-${resolvedAnimation}` : ''}`}
      onClick={handleClick}
      onAnimationEnd={handleAnimationEnd}
    />
  );
}

export default AnimatedIcon;
