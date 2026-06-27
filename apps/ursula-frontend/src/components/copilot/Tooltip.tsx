'use client';

import { useState, useRef, useEffect } from 'react';
import { Info, Lightbulb, Zap, Target, HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  type?: 'info' | 'suggestion' | 'quick-tip' | 'command' | 'help';
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export default function Tooltip({
  content,
  children,
  type = 'info',
  position = 'top',
  delay = 500,
  className = ''
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHovered) {
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true);
      }, delay);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setIsVisible(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isHovered, delay]);

  const getIcon = () => {
    switch (type) {
      case 'suggestion':
        return <Lightbulb className="w-4 h-4 text-yellow-400" />;
      case 'quick-tip':
        return <Zap className="w-4 h-4 text-blue-400" />;
      case 'command':
        return <Target className="w-4 h-4 text-green-400" />;
      case 'help':
        return <HelpCircle className="w-4 h-4 text-purple-400" />;
      default:
        return <Info className="w-4 h-4 text-gray-400" />;
    }
  };

  const getTooltipStyle = () => {
    const baseClasses = 'absolute z-50 p-3 rounded-lg shadow-lg border max-w-xs transition-all duration-200';
    const typeClasses = {
      info: 'bg-gray-800 border-gray-700 text-gray-200',
      suggestion: 'bg-yellow-900 border-yellow-700 text-yellow-100',
      'quick-tip': 'bg-blue-900 border-blue-700 text-blue-100',
      command: 'bg-green-900 border-green-700 text-green-100',
      help: 'bg-purple-900 border-purple-700 text-purple-100'
    };

    const positionClasses = {
      top: 'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
      bottom: 'top-full left-1/2 transform -translate-x-1/2 mt-2',
      left: 'right-full top-1/2 transform -translate-y-1/2 mr-2',
      right: 'left-full top-1/2 transform -translate-y-1/2 ml-2'
    };

    return `${baseClasses} ${typeClasses[type]} ${positionClasses[position]}`;
  };

  const getArrowStyle = () => {
    const baseClasses = 'absolute w-0 h-0 border-l-8 border-r-8 border-t-8';
    const arrowColors = {
      info: 'border-transparent border-t-gray-800',
      suggestion: 'border-transparent border-t-yellow-900',
      'quick-tip': 'border-transparent border-t-blue-900',
      command: 'border-transparent border-t-green-900',
      help: 'border-transparent border-t-purple-900'
    };

    const arrowPositions = {
      top: 'top-full left-1/2 transform -translate-x-1/2 -mt-1',
      bottom: 'bottom-full left-1/2 transform -translate-x-1/2 -mb-1 rotate-180',
      left: 'left-full top-1/2 transform -translate-y-1/2 -ml-1 rotate-90',
      right: 'right-full top-1/2 transform -translate-y-1/2 -mr-1 -rotate-90'
    };

    return `${baseClasses} ${arrowColors[type]} ${arrowPositions[position]}`;
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}

      {isVisible && (
        <div className={getTooltipStyle()}>
          <div className={getArrowStyle()} />
          <div className="flex items-start space-x-2">
            <div className="flex-shrink-0 mt-0.5">
              {getIcon()}
            </div>
            <div className="text-xs leading-relaxed">
              {content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Preset tooltip components for common use cases
export function CommandTooltip({ command, description }: { command: string; description: string }) {
  return (
    <Tooltip
      type="command"
      content={`${command}: ${description}`}
    >
      <div className="cursor-help">
        <HelpCircle className="w-3 h-3 text-gray-400 hover:text-green-400 transition-colors" />
      </div>
    </Tooltip>
  );
}

export function SuggestionTooltip({ suggestion }: { suggestion: string }) {
  return (
    <Tooltip
      type="suggestion"
      content={suggestion}
      position="right"
    >
      <div className="cursor-help">
        <Lightbulb className="w-3 h-3 text-yellow-400 hover:text-yellow-300 transition-colors" />
      </div>
    </Tooltip>
  );
}

export function QuickTipTooltip({ tip }: { tip: string }) {
  return (
    <Tooltip
      type="quick-tip"
      content={tip}
      delay={300}
    >
      <div className="cursor-help">
        <Zap className="w-3 h-3 text-blue-400 hover:text-blue-300 transition-colors" />
      </div>
    </Tooltip>
  );
}
