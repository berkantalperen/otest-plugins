<?php
/**
 * Plugin Name: OTEST Dashboard & Redirect
 * Description: Dashboard + Force Redirects for Login & Frontend pages.
 * Version: 1.5
 * Author: OTEST
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// ---------------------------------------------------------
// 1. DASHBOARD SHORTCODE [otest_dashboard]
// ---------------------------------------------------------
function otest_render_user_dashboard() {
    if ( ! is_user_logged_in() ) {
        return '<p>Lütfen giriş yapınız.</p>';
    }

    $user = wp_get_current_user();
    
    // Container
    $html = '<div class="otest-simple-menu">';

    // --- 1. Internal Apps ---
    if ( function_exists( 'otest_internal_apps_user_has_access' ) && otest_internal_apps_user_has_access() ) {
        $html .= '<a href="' . home_url( '/apps/' ) . '" class="otest-item-btn">📂 İç Yazılımlar (Apps)</a>';
    }

    // --- 2. Internal Docs ---
    if ( function_exists( 'otest_internal_docs_user_has_access' ) && otest_internal_docs_user_has_access() ) {
        $html .= '<a href="' . home_url( '/docs/' ) . '" class="otest-item-btn">📘 Dokümantasyon</a>';
    }

    // --- 3. Client CSV (Musteri Panel) ---
    $has_client_access = false;
    if ( current_user_can( 'manage_options' ) ) {
        $has_client_access = true;
    } else {
        foreach ( (array) $user->roles as $role ) {
            if ( str_starts_with( $role, 'client_' ) ) {
                $has_client_access = true;
                break;
            }
        }
    }

    if ( $has_client_access ) {
        $html .= '<a href="' . home_url( '/musteri-panel/' ) . '" class="otest-item-btn">📊 Müşteri Verileri</a>';
    }

    // --- 4. Overtime (Mesai) ---
    $html .= '<a href="' . home_url( '/mesai-listem/' ) . '" class="otest-item-btn">🕒 Mesai Takip</a>';

    $html .= '</div>'; // End container

    // CSS
    $html .= '
    <style>
        .otest-simple-menu {
            max-width: 600px;
            margin: 20px 0;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .otest-item-btn {
            display: block;
            width: 100%;
            padding: 15px 20px;
            background-color: #f0f0f1;
            border: 1px solid #ccd0d4;
            border-left: 5px solid #003366;
            color: #333;
            text-decoration: none;
            font-size: 16px;
            font-weight: 600;
            border-radius: 4px;
            transition: all 0.2s ease;
        }
        .otest-item-btn:hover {
            background-color: #fff;
            border-left-width: 10px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            color: #003366;
        }
    </style>';

    return $html;
}
add_shortcode( 'otest_dashboard', 'otest_render_user_dashboard' );


// ---------------------------------------------------------
// 2. FORCE LOGIN REDIRECT (THE NUCLEAR OPTION)
// ---------------------------------------------------------

/**
 * Fires immediately after login is verified.
 * Interrupts WordPress execution and forces a jump to the dashboard.
 */
function otest_nuclear_redirect( $user_login, $user ) {
    // 1. Ignore AJAX requests (don't break popups)
    if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) {
        return;
    }

    // 2. Force Redirect
    wp_redirect( home_url( '/kullanici-paneli/' ) );
    exit; // Stop everything else from loading
}
// Highest priority possible to run last and override others
add_action( 'wp_login', 'otest_nuclear_redirect', PHP_INT_MAX, 2 );


// ---------------------------------------------------------
// 3. FRONTEND "ALREADY LOGGED IN" REDIRECT
// ---------------------------------------------------------

/**
 * Checks if a logged-in user is visiting a login page.
 */
function otest_frontend_already_logged_in() {
    if ( is_user_logged_in() ) {
        // Add all slugs that represent your login page
        if ( is_page( 'login' ) || is_page( 'giris' ) || is_page( 'uye-girisi' ) || is_page( 'my-account' ) ) {
            wp_redirect( home_url( '/kullanici-paneli/' ) );
            exit;
        }
    }
}
add_action( 'template_redirect', 'otest_frontend_already_logged_in' );

/**
 * Redirects if accessing wp-login.php directly while logged in
 */
function otest_direct_wp_login_redirect() {
    global $pagenow;
    if ( 'wp-login.php' === $pagenow && is_user_logged_in() && !isset( $_REQUEST['action'] ) ) {
        wp_redirect( home_url( '/kullanici-paneli/' ) );
        exit;
    }
}
add_action( 'init', 'otest_direct_wp_login_redirect' );