(function(){
  function clean(){
    document.querySelectorAll('[class*=darkreader]').forEach(function(e){e.remove()});
    document.querySelectorAll('[style]').forEach(function(e){
      var s=e.getAttribute('style');
      if(!s)return;
      var a=s.split(';').filter(function(d){
        d=d.trim();
        if(!d)return false;
        if(/^--darkreader/i.test(d))return false;
        if(/^background-(image|position|size|repeat|color)\s*:\s*(initial|unset)/i.test(d))return false;
        if(/^(color|border-color|outline-color|text-decoration-color|-webkit-text-fill-color|stroke|fill)\s*:[^;]*!important/i.test(d))return false;
        if(/=/.test(d))return false;
        return true
      }).join(';');
      if(a!==e.getAttribute('style'))e.setAttribute('style',a);
    });
    document.querySelectorAll('[data-darkreader-inline-stroke],[data-darkreader-inline-color],[data-darkreader-inline-bgcolor],[data-darkreader-inline-fill]').forEach(function(e){
      e.removeAttribute('data-darkreader-inline-stroke');
      e.removeAttribute('data-darkreader-inline-color');
      e.removeAttribute('data-darkreader-inline-bgcolor');
      e.removeAttribute('data-darkreader-inline-fill');
    });
  }
  clean();
  new MutationObserver(clean).observe(document.documentElement,{
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:['style','class','data-darkreader-inline-stroke','data-darkreader-inline-color','data-darkreader-inline-bgcolor','data-darkreader-inline-fill']
  });
})();
