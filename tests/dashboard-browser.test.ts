import { describe, expect, it } from 'vitest';

import { dashboardOpenCommand } from '../src/dashboard/browser.js';

describe('dashboard browser command', () => {
  it('uses the native opener without invoking a shell', () => {
    const url = 'http://127.0.0.1:8790/#access_token=test';
    expect(dashboardOpenCommand(url, 'darwin')).toEqual({ command: 'open', args: [url] });
    expect(dashboardOpenCommand(url, 'linux')).toEqual({ command: 'xdg-open', args: [url] });
    expect(dashboardOpenCommand(url, 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', url],
    });
  });
});