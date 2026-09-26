/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import {
  AiDraftMock,
  AnalyticsMock,
  AutomationMock,
  ConversationMock,
  QuoteMock,
} from './mocks';
import type { MockKey } from './product-tour';

/**
 * Client-only picker for the tour visuals (#1972). Lives behind a
 * `dynamic(..., { ssr: false })` boundary in ProductTour so the mock DOM
 * never reaches the landing HTML or the RSC flight payload; the landing
 * page passes only a string key, which keeps the serialized props tiny.
 */
export default function TourVisual({ name }: { name: MockKey }) {
  switch (name) {
    case 'ai':
      return <AiDraftMock />;
    case 'automation':
      return <AutomationMock />;
    case 'conversations':
      return <ConversationMock />;
    case 'revenue':
      return <QuoteMock />;
    case 'analytics':
      return <AnalyticsMock />;
  }
}
