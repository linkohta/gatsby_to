const injectTwitterScript = () => {
  function addJS(jsCode) {
    const s = document.createElement(`script`)

    s.type = `text/javascript`
    s.innerText = jsCode
    document.getElementsByTagName(`head`)[0].appendChild(s)
  }
  addJS(`
    window.twttr = (function(d, s, id) {
      var js,
        fjs = d.getElementsByTagName(s)[0],
        t = window.twttr || {};
      if (d.getElementById(id)) return t;
      js = d.createElement(s);
      js.id = id;
      js.src = "https://platform.twitter.com/widgets.js";
      fjs.parentNode.insertBefore(js, fjs);
      t._e = [];
      t.ready = function(f) {
        t._e.push(f);
      };
      return t;
    })(document, "script", "twitter-wjs");
  `)
}

let injectedTwitterScript = false

const embedClasses = [
  `.twitter-tweet`,
  `.twitter-timeline`,
  `.twitter-follow-button`,
  `.twitter-share-button`,
].join(`,`)

exports.onRouteUpdate = () => {
  // 埋め込み要素がある場合は、twitter のスクリプトを（まだ読み込まれて
  // いなければ）遅延読み込みし、その後 twitter の load 関数を実行する。
  if (document.querySelector(embedClasses) !== null) {
    if (!injectedTwitterScript) {
      injectTwitterScript()
      injectedTwitterScript = true
    }

    if (
      typeof twttr !== `undefined` &&
      window.twttr.widgets &&
      typeof window.twttr.widgets.load === `function`
    ) {
      window.twttr.widgets.load()
    }
  }
}
