/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { clientLogDebug } from '@/lib/client-logger';

export default function TestPage() {
  const [test, setTest] = useState('Loading...');
  
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    setTest('JavaScript is working! Time: ' + new Date().toLocaleTimeString());
  }, []);
  
  if (process.env.NODE_ENV !== 'development') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">This page is only available in development.</p>
      </div>
    );
  }
  
  return (
    <div className="p-12 text-center font-sans">
      <h1>NuCRM JS Test</h1>
      <p className="text-2xl text-green-600">{test}</p>
      <button 
        onClick={() => clientLogDebug('test-js:button-click', 'Button works!')}
        className="px-8 py-4 text-lg bg-violet-600 text-white rounded-xl cursor-pointer hover:bg-violet-700"
      >
        Click Me
      </button>
    </div>
  );
}
