'use client';
import { useState, useEffect } from 'react';

export default function TestPage() {
  const [test, setTest] = useState('Loading...');
  
  useEffect(() => {
    setTest('JavaScript is working! Time: ' + new Date().toLocaleTimeString());
  }, []);
  
  return (
    <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1>NuCRM JS Test</h1>
      <p style={{ fontSize: '24px', color: 'green' }}>{test}</p>
      <button 
        onClick={() => alert('Button works!')}
        style={{ 
          padding: '15px 30px', 
          fontSize: '18px', 
          background: '#7c3aed', 
          color: 'white', 
          border: 'none', 
          borderRadius: '10px',
          cursor: 'pointer'
        }}
      >
        Click Me
      </button>
    </div>
  );
}