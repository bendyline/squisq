import { describe, expect, it } from 'vitest';
import { externalLinkUrl, inspectLink } from '../linkSafety/inspectLink';

const inspect = (href: string, text?: string) => {
  const url = externalLinkUrl(href);
  if (!url) throw new Error(`not a web link: ${href}`);
  return inspectLink(url, text);
};

describe('externalLinkUrl', () => {
  it('reads web addresses, including protocol-relative ones', () => {
    expect(externalLinkUrl('https://x.test/a')?.href).toBe('https://x.test/a');
    expect(externalLinkUrl(' HTTP://X.test ')?.hostname).toBe('x.test');
    expect(externalLinkUrl('//cdn.test/a')?.href).toBe('https://cdn.test/a');
  });

  it.each(['mailto:me@x.test', 'tel:123', 'notes/a.md', '#top', 'javascript:alert(1)', 'https://'])(
    'is not a web link: %s',
    (href) => {
      expect(externalLinkUrl(href)).toBeNull();
    },
  );
});

describe('inspectLink', () => {
  it('names the site the browser contacts', () => {
    const result = inspect('https://Accounts.Example.com/a?b=1');
    expect(result.host).toBe('accounts.example.com');
    expect(result).toMatchObject({ internationalHost: false, insecure: false });
    expect(result.userName).toBeUndefined();
    expect(result.textHost).toBeUndefined();
    expect(result.leadsTo).toBeUndefined();
  });

  it('sees through a user name dressed as a site', () => {
    const result = inspect('https://paypal.com@evil.test/login');
    expect(result.host).toBe('evil.test');
    expect(result.userName).toBe('paypal.com');
  });

  it('flags link text that names another site, but not the same site', () => {
    expect(inspect('https://evil.test/', 'https://paypal.com/signin').textHost).toBe('paypal.com');
    expect(inspect('https://evil.test/', 'paypal.com').textHost).toBe('paypal.com');
    expect(inspect('https://www.paypal.com/x', 'paypal.com').textHost).toBeUndefined();
    expect(inspect('https://mail.paypal.com/x', 'paypal.com').textHost).toBeUndefined();
    expect(inspect('https://evil.test/', 'Check activity').textHost).toBeUndefined();
    expect(inspect('https://evil.test/', 'me@paypal.com').textHost).toBeUndefined();
  });

  it('follows a redirect parameter to the site it passes the reader on to', () => {
    const google = inspect(
      'https://accounts.google.com/AccountChooser?Email=a@b.test&continue=https://myaccount.google.com/alert',
    );
    expect(google.leadsTo).toBeUndefined(); // one organization's own sites
    expect(inspect('https://news.bbc.co.uk/', 'bbc.co.uk').textHost).toBeUndefined();
    expect(inspect('https://evil.co.uk/', 'bbc.co.uk').textHost).toBe('bbc.co.uk');
    const wrapped = inspect(
      'https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fevil.test%2Fx&data=1',
      'evil.test',
    );
    expect(wrapped.leadsTo?.hostname).toBe('evil.test');
    expect(wrapped.textHost).toBeUndefined();
  });

  it('marks international and unencrypted addresses', () => {
    expect(inspect('https://аpple.com/').internationalHost).toBe(true);
    expect(inspect('https://аpple.com/').host.startsWith('xn--')).toBe(true);
    expect(inspect('http://x.test/').insecure).toBe(true);
  });
});
