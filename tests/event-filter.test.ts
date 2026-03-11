import { filterOutboundEvent, filterInboundEvent } from '../src/filters/event-filter';

describe('filterOutboundEvent', () => {
  describe('Stage 1 mappings', () => {
    it('maps "Lead Created" to SubmitForm', () => {
      const result = filterOutboundEvent('Lead Created');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('SubmitForm');
      expect(result.dfoStage).toBe(1);
    });

    it('maps "New Lead" to SubmitForm', () => {
      const result = filterOutboundEvent('New Lead');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('SubmitForm');
    });
  });

  describe('Stage 2 mappings', () => {
    it('maps "Lead Contacted" to Contact', () => {
      const result = filterOutboundEvent('Lead Contacted');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('Contact');
      expect(result.dfoStage).toBe(2);
    });

    it('maps "Demo Scheduled" to Schedule', () => {
      const result = filterOutboundEvent('Demo Scheduled');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('Schedule');
      expect(result.dfoStage).toBe(2);
    });

    it('maps "Meeting Scheduled" to Schedule', () => {
      const result = filterOutboundEvent('Meeting Scheduled');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('Schedule');
    });
  });

  describe('Stage 3 mappings', () => {
    it('maps "Lead Qualified" to CompleteRegistration', () => {
      const result = filterOutboundEvent('Lead Qualified');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('CompleteRegistration');
      expect(result.dfoStage).toBe(3);
    });

    it('maps "Opportunity Created" to SubmitApplication', () => {
      const result = filterOutboundEvent('Opportunity Created');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('SubmitApplication');
      expect(result.dfoStage).toBe(3);
    });
  });

  describe('Stage 4 mappings', () => {
    it('maps "Deal Won" to Purchase', () => {
      const result = filterOutboundEvent('Deal Won');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('Purchase');
      expect(result.dfoStage).toBe(4);
    });

    it('maps "Application Approved" to ApplicationApproval', () => {
      const result = filterOutboundEvent('Application Approved');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('ApplicationApproval');
      expect(result.dfoStage).toBe(4);
    });

    it('maps "Subscription Started" to Subscribe', () => {
      const result = filterOutboundEvent('Subscription Started');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('Subscribe');
      expect(result.dfoStage).toBe(4);
    });

    it('maps "Trial Started" to StartTrial', () => {
      const result = filterOutboundEvent('Trial Started');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('StartTrial');
      expect(result.dfoStage).toBe(4);
    });
  });

  describe('Case sensitivity', () => {
    it('handles uppercase metric name: LEAD CREATED → SubmitForm', () => {
      const result = filterOutboundEvent('LEAD CREATED');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('SubmitForm');
    });

    it('handles mixed case: Lead Created → SubmitForm', () => {
      const result = filterOutboundEvent('Lead Created');
      expect(result.shouldProcess).toBe(true);
      expect(result.tiktokEvent).toBe('SubmitForm');
    });
  });

  describe('Unknown metrics', () => {
    it('returns shouldProcess=false for unknown metric', () => {
      const result = filterOutboundEvent('Unknown Metric XYZ');
      expect(result.shouldProcess).toBe(false);
      expect(result.tiktokEvent).toBeUndefined();
    });

    it('returns shouldProcess=false for empty string', () => {
      const result = filterOutboundEvent('');
      expect(result.shouldProcess).toBe(false);
    });
  });
});

describe('filterInboundEvent', () => {
  it('accepts valid TikTok standard events', () => {
    const validEvents = [
      'SubmitForm', 'Contact', 'Schedule', 'CompleteRegistration',
      'SubmitApplication', 'Purchase', 'ApplicationApproval', 'Subscribe', 'StartTrial',
    ];
    for (const event of validEvents) {
      const result = filterInboundEvent(event);
      expect(result.shouldProcess).toBe(true);
    }
  });

  it('rejects unknown events', () => {
    const result = filterInboundEvent('UnknownEvent');
    expect(result.shouldProcess).toBe(false);
  });

  it('rejects empty string', () => {
    const result = filterInboundEvent('');
    expect(result.shouldProcess).toBe(false);
  });
});
