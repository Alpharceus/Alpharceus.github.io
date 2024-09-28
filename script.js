$(document).ready(function(){
    $(window).scroll(function(){
        // sticky navbar on scroll script
        if(this.scrollY > 20){
            $('.navbar').addClass("sticky");
        }else{
            $('.navbar').removeClass("sticky");
        }
        
        // scroll-up button show/hide script
        if(this.scrollY > 500){
            $('.scroll-up-btn').addClass("show");
        }else{
            $('.scroll-up-btn').removeClass("show");
        }
    });

    // slide-up script
    $('.scroll-up-btn').click(function(){
        $('html').animate({scrollTop: 0});
        // removing smooth scroll on slide-up button click
        $('html').css("scrollBehavior", "auto");
    });

    $('.navbar .menu li a').click(function(){
        // applying again smooth scroll on menu items click
        $('html').css("scrollBehavior", "smooth");
    });

    // toggle menu/navbar script
    $('.menu-btn').click(function(){
        $('.navbar .menu').toggleClass("active");
        $('.menu-btn i').toggleClass("active");
    });

    // typing text animation script
    var typed = new Typed(".typing", {
        strings: ["Astrophysicist", "Developer", "Quantum Computing Engineer", "ML/AI Engineer", "Computer Engineer"],
        typeSpeed: 100,
        backSpeed: 60,
        loop: true
    });

    var typed = new Typed(".typing-2", {
        strings: ["Astrophysicist", "Developer", "Quantum Engineer", "ML/AI Engineer", "Computer Engineer"],
        typeSpeed: 100,
        backSpeed: 60,
        loop: true
    });

    // owl carousel script
    $('.carousel').owlCarousel({
        margin: 20,
        loop: true,
        autoplay: true,
        autoplayTimeOut: 2000,
        autoplayHoverPause: true,
        responsive: {
            0:{
                items: 1,
                nav: false
            },
            600:{
                items: 2,
                nav: false
            },
            1000:{
                items: 3,
                nav: false
            }
        }
    });
    // Dark mode toggle logic
    const darkModeSwitch = document.getElementById('darkModeSwitch');
    darkModeSwitch.addEventListener('change', function () {
        document.body.classList.toggle('dark-mode');
        
        // Store user preference in local storage
        if (this.checked) {
            localStorage.setItem('darkMode', 'enabled');
        } else {
            localStorage.setItem('darkMode', 'disabled');
        }
    });

    // Retrieve user preference
    const darkMode = localStorage.getItem('darkMode');
    if (darkMode === 'enabled') {
        document.body.classList.add('dark-mode');
        darkModeSwitch.checked = true;
    }

    // Lightbox functionality
document.querySelectorAll('.lightbox').forEach(lightbox => {
    lightbox.addEventListener('click', function(e) {
        e.preventDefault();
        const imageUrl = this.getAttribute('href');
        const lightboxOverlay = document.createElement('div');
        lightboxOverlay.classList.add('lightbox-overlay');
        lightboxOverlay.innerHTML = `<div class="lightbox-content"><img src="${imageUrl}" alt="Certificate"><span class="close-lightbox">&times;</span></div>`;
        document.body.appendChild(lightboxOverlay);

        // Close lightbox on click
        document.querySelector('.close-lightbox').addEventListener('click', function() {
            lightboxOverlay.remove();
        });

        // Close lightbox on outside click
        lightboxOverlay.addEventListener('click', function(e) {
            if (e.target === this) {
                lightboxOverlay.remove();
            }
        });
    });
});

   

});

