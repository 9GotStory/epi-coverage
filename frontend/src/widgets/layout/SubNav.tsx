import React from 'react';

interface SubNavProps {
  title: string;
  action?: React.ReactNode;
}

export function SubNav({ title, action }: SubNavProps) {
  return (
    <div className="h-[52px] bg-[#f5f5f7]/80 backdrop-blur-xl w-full flex items-center px-4 md:px-8 z-40 sticky top-[44px] border-b border-black/5">
      <div className="max-w-[1440px] mx-auto w-full flex items-center justify-between">
        <h1 className="text-[21px] font-semibold tracking-[0.231px] text-[#1d1d1f]">
          {title}
        </h1>
        {action && (
          <div className="flex items-center space-x-2">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
