import { TimezoneService } from './timezone.service';

describe('timezoneService', () => {
  const service = new TimezoneService();

  beforeEach(() => {
    service.resetForTests();
  });

  it('starts with null timezone', () => {
    expect(service.getTimezone()).toBeNull();
  });

  it('lists whitelist options as label/value', () => {
    const opts = service.getTimezoneOptions();
    expect(opts.length).toBe(5);
    expect(opts[2]).toEqual({
      label: 'Asia/Shanghai (GMT+8)',
      value: 'Asia/Shanghai',
    });
    expect(opts.every((o) => o.label && o.value)).toBe(true);
  });

  it('sets an allowed timezone and returns {}', () => {
    expect(service.setTimezone('Asia/Tokyo')).toEqual({});
    expect(service.getTimezone()).toBe('Asia/Tokyo');
  });

  it('rejects unknown or empty timezone', () => {
    expect(() => service.setTimezone('Mars/Olympus')).toThrow(/Invalid timezone/);
    expect(() => service.setTimezone('')).toThrow(/Invalid timezone/);
    expect(() => service.setTimezone(undefined)).toThrow(/Invalid timezone/);
    expect(service.getTimezone()).toBeNull();
  });
});
