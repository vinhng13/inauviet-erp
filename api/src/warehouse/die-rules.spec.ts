import { allowedActions, fmtCm, parseDieNotes, parseSheetSize, parseSize, sizeMatches, sizeQuery, statusAfterMove, TRANSITIONS } from './die-rules';
import { excelDate } from './xlsx-reader';

describe('die rules', () => {
  it('only allows in-place actions that fit the status and where the die is', () => {
    expect(allowedActions('MAKING', true, false)).toEqual(['PASS', 'DEFECT']); // kiểm tra tại nơi làm khuôn
    expect(allowedActions('DEFECT', true, false)).toEqual(['PASS']); // làm lại xong, kiểm tra lại
    expect(allowedActions('READY', false, false)).toEqual(['DEFECT', 'DISPOSE', 'MOVE']);
    expect(allowedActions('IN_USE', true, false)).toEqual(['DEFECT']);
    expect(allowedActions('READY', false, true)).toEqual([]);
    expect(allowedActions('DISPOSED', false, false)).toEqual([]);
    expect(TRANSITIONS.PASS.to).toBe('READY');
  });

  it('sets the status from where a die is moved to', () => {
    expect(statusAfterMove('READY', { toKho: false, repair: false })).toBe('IN_USE'); // bế khuôn
    expect(statusAfterMove('IN_USE', { toKho: true, repair: false })).toBe('READY'); // bế xong về kho
    expect(statusAfterMove('READY', { toKho: true, repair: false })).toBe('READY'); // kho → kho
    expect(statusAfterMove('DEFECT', { toKho: false, repair: true })).toBe('REPAIRING'); // gửi sửa
    expect(statusAfterMove('MAKING', { toKho: false, repair: true })).toBe('MAKING');
  });

  it('finds dies by size in any order within tolerance', () => {
    expect(sizeQuery('24x24x12.5')).toEqual([24, 24, 12.5]);
    expect(sizeQuery('24 x 24,5 cm')).toEqual([24, 24.5]);
    expect(sizeQuery('yên bài')).toBeNull();
    expect(sizeMatches([24, 24, 12.5], [24, 24, 12])).toBe(true);
    expect(sizeMatches([12.5, 24, 24], [24, 12.5, 24])).toBe(true);
    expect(sizeMatches([24, 24, 12.5], [24, 24, 11.9])).toBe(false);
    expect(sizeMatches([61, 41], [61, 41, null])).toBe(true);
    expect(sizeMatches([20, 15, 5], [20, 15, null])).toBe(false);
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
