import { allowedActions, fmtCm, parseDieNotes, parseSheetSize, parseSize, TRANSITIONS } from './die-rules';
import { excelDate } from './xlsx-reader';

describe('die rules', () => {
  it('only allows actions that fit the current status', () => {
    expect(allowedActions('READY')).toEqual(['ISSUE', 'RETURN', 'DEFECT', 'DISPOSE', 'MOVE']);
    expect(allowedActions('IN_USE')).toEqual(['KEEP', 'RETURN', 'DEFECT']);
    expect(allowedActions('CHECKING')).toEqual(['PASS', 'DEFECT', 'SEND_REPAIR', 'DISPOSE']);
    expect(allowedActions('DISPOSED')).toEqual([]);
    // every non-final status has a way out
    for (const s of ['READY', 'IN_USE', 'CHECKING', 'REPAIRING', 'DEFECT', 'BROKEN'] as const) expect(allowedActions(s).length).toBeGreaterThan(0);
    expect(TRANSITIONS.ISSUE.to).toBe('IN_USE');
  });

  it('reads sizes typed by hand', () => {
    expect(parseSize('30x31,5x15')).toEqual({ lengthCm: 30, widthCm: 31.5, heightCm: 15, sizeText: null });
    expect(parseSize('32 x 24')).toEqual({ lengthCm: 32, widthCm: 24, heightCm: null, sizeText: null });
    expect(parseSize('21x28x10cm')).toMatchObject({ lengthCm: 21, widthCm: 28, heightCm: 10 });
    expect(parseSize('22x31x7 +16.5x23x5.3')).toMatchObject({ lengthCm: null, sizeText: '22x31x7 +16.5x23x5.3' });
    expect(parseSize('35x35x12c')).toMatchObject({ lengthCm: 35, heightCm: 12, sizeText: null });
    expect(parseSize('Túi lịch 65x43')).toEqual({ lengthCm: 65, widthCm: 43, heightCm: null, sizeText: 'Túi lịch 65x43' });
    expect(parseSize('  ')).toMatchObject({ lengthCm: null, sizeText: null });
    expect(parseSheetSize('21,5 x 32')).toEqual([21.5, 32]);
    expect(fmtCm(31.5)).toBe('31,5');
  });

  it('splits free notes into orientation, pieces and ups', () => {
    expect(parseDieNotes('Dọc', '2 mảnh')).toEqual({ orientation: 'PORTRAIT', pieces: 2, ups: null, note: null });
    expect(parseDieNotes('8 bát/1 khuôn', 'Lệnh sản xuất mới')).toEqual({ orientation: null, pieces: null, ups: 8, note: 'Lệnh sản xuất mới' });
    expect(parseDieNotes('Ngang', null, '')).toMatchObject({ orientation: 'LANDSCAPE', note: null });
  });

  it('reads Excel dates as serials or d/m/yyyy', () => {
    expect(excelDate(46337)).toBe('2026-11-11');
    expect(excelDate('6/11/2026')).toBe('2026-11-06');
    expect(excelDate('01/12/2026')).toBe('2026-12-01');
    expect(excelDate('31/13/2026')).toBeNull();
    expect(excelDate(0)).toBeNull();
    expect(excelDate(null)).toBeNull();
  });
});
