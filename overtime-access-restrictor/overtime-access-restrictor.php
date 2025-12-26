<?php
/*
Plugin Name: Overtime Access Restrictor
Description: Manager rollerinin Overtime sayfasına erişimini engeller.
Version: 1.0
Author: Çağatay Koçoğlu
*/

// Manager'ları Overtime sayfasından engelle
add_action('admin_init', function() {
    $user = wp_get_current_user();
    $login = $user->user_login ?? '';

    // Eğer giriş yapan kişi 'editor' değilse
    if ($login !== 'editor') {

        // Overtime sayfası (örnek: ?page=om31-overtime)
        if (isset($_GET['page']) && $_GET['page'] === 'om31-overtime') {
            wp_die('Bu sayfayı görüntüleme yetkiniz yok.');
        }

        // Kullanıcılar sayfası (users.php)
        $current_screen = basename($_SERVER['PHP_SELF']);
        if ($current_screen === 'users.php') {
            wp_die('Bu sayfayı görüntüleme yetkiniz yok.');
        }
    }
});

// Manager'ların menüde Overtime'ı görmesini engelle
add_action('admin_menu', function() {
    $user = wp_get_current_user();
    $login = $user->user_login ?? '';

    if ($login !== 'editor') {
        remove_menu_page('om31-overtime'); // Overtime menüsü
        remove_menu_page('users.php');     // Kullanıcılar menüsü
    }
}, 999);
