// Tests for access gate page detection

import { describe, expect, it } from 'vitest';
import { isAccessGateHtml } from '../../src/utils/page-access.ts';

describe('isAccessGateHtml', () => {
  it('detects premium registration boxes', () => {
    expect(isAccessGateHtml('<div class="Premium_Regist_Box">登録</div>')).toBe(true);
  });

  it('does not treat dummy sample tables as an access gate by themselves', () => {
    expect(isAccessGateHtml('<table class="Paddock_Table SampleDummy"></table>')).toBe(false);
  });

  it('detects Japanese login guidance for gated content', () => {
    expect(isAccessGateHtml('<p>ログインして続きをご覧ください</p>')).toBe(true);
  });

  it('does not reject normal fetched content', () => {
    expect(isAccessGateHtml('<table class="Paddock_Table"><tr><td>1</td></tr></table>')).toBe(
      false,
    );
  });

  it('treats pages containing the authenticated header icon as not gated even when the registration box is still in the DOM', () => {
    const html =
      '<a class="Icon_Header Icon_Account"><span>アカウント</span></a>' +
      '<div class="Premium_Regist_Box disp_none" style="display: none;">登録</div>' +
      '<table id="All_Comment_Table" class="Stable_Comment Comment_Table_Show_All"></table>';
    expect(isAccessGateHtml(html)).toBe(false);
  });

  it('treats pages with the unauthenticated Icon_Login header as gated', () => {
    const html =
      '<a class="Icon_Header Icon_Login"><span>ログイン/会員登録</span></a>' +
      '<table id="All_Comment_Table" class="Stable_Comment"></table>';
    expect(isAccessGateHtml(html)).toBe(true);
  });

  it('treats pages that reveal the registration box via JS as gated', () => {
    const html = `<script>$('#Premium_Regist_Box_comment').show();</script>`;
    expect(isAccessGateHtml(html)).toBe(true);
  });

  it('does not flag pages that explicitly hide the registration box via toggle(false) as gated', () => {
    const html =
      '<a class="Icon_Header Icon_Account"><span>アカウント</span></a>' +
      `<script>$('#Premium_Regist_Box_comment').toggle(false);</script>`;
    expect(isAccessGateHtml(html)).toBe(false);
  });
});
