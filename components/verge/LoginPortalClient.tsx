'use client';

import dynamic from 'next/dynamic';

const LoginPortal = dynamic(() => import('./LoginPortal'), { ssr: false });

export default LoginPortal;
