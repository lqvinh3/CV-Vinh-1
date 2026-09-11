var STATE = { current: 'en', list: ['vi', 'en'] };



function toggleLanguage() {
    const enEls = document.querySelectorAll('.lang-en');
    const viEls = document.querySelectorAll('.lang-vi');
    const btn = document.getElementById('toggleLangBtn');

    if (!enEls.length) return;

    // const isEnVisible = enEls[0].style.display !== 'none' && enEls[0].style.display !== '';
    STATE.current = STATE.current == 'en' ? 'vi' : 'en';


    if (STATE.current == 'vi') {
        enEls.forEach(el => el.style.display = 'none');
        viEls.forEach(el => el.style.display = 'block');
        if (btn) btn.innerText = 'Chuyển tiếng Anh';
    } else {
        enEls.forEach(el => el.style.display = 'block');
        viEls.forEach(el => el.style.display = 'none');
        if (btn) btn.innerText = 'Chuyển tiếng Việt';
    }
}

function goToCoverLetter(event) {
    if (event) event.preventDefault();
    localStorage.setItem('returnUrl', window.location.href);
    localStorage.setItem('returnScrollPos', window.scrollY);
    window.location.href = 'covert-letter.html';
}

function goBack(event) {
    if (event) event.preventDefault();
    const returnUrl = localStorage.getItem('returnUrl');
    if (returnUrl) {
        window.location.href = returnUrl;
    } else if (document.referrer && !document.referrer.includes('covert-letter.html')) {
        window.location.href = document.referrer;
    } else {
        window.history.back();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const savedScroll = localStorage.getItem('returnScrollPos');
    if (savedScroll !== null) {
        window.scrollTo(0, parseInt(savedScroll, 10));
        localStorage.removeItem('returnScrollPos');
    }
});

toggleLanguage();
