<?php
/**
 * Plugin Name: OTEST Internal Apps
 * Description: Serves internal static tools from a protected /internal-apps/ URL.
 * Version: 1.2.0
 * Author: Berkant Alperen
 * Text Domain: otest-internal-apps
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * 1. CONFIGURATION: Allowed Roles
 * Uses filters for extensibility.
 */
function otest_internal_apps_allowed_roles() {
    $roles = array(
        'administrator',
        'otest_employee',
    );
    return apply_filters( 'otest_internal_apps_allowed_roles', $roles );
}

/**
 * 2. ACCESS CHECK
 */
function otest_internal_apps_user_has_access() {
    if ( ! is_user_logged_in() ) {
        return false;
    }

    $user = wp_get_current_user();
    if ( empty( $user->roles ) ) {
        return false;
    }

    $allowed_roles = otest_internal_apps_allowed_roles();
    return (bool) array_intersect( $allowed_roles, $user->roles );
}

/**
 * 3. REWRITE RULES & QUERY VARS
 */
function otest_internal_apps_add_rewrite_rules() {
    add_rewrite_rule(
        '^internal-apps/?$',
        'index.php?otest_internal_app=index.html',
        'top'
    );
    add_rewrite_rule(
        '^internal-apps/(.+)$',
        'index.php?otest_internal_app=$matches[1]',
        'top'
    );
}
add_action( 'init', 'otest_internal_apps_add_rewrite_rules' );

function otest_internal_apps_add_query_var( $vars ) {
    $vars[] = 'otest_internal_app';
    return $vars;
}
add_filter( 'query_vars', 'otest_internal_apps_add_query_var' );

function otest_internal_apps_activate() {
    otest_internal_apps_add_rewrite_rules();
    flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'otest_internal_apps_activate' );

function otest_internal_apps_deactivate() {
    flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'otest_internal_apps_deactivate' );

/**
 * 4. FILE SERVING LOGIC
 */
function otest_internal_apps_serve_file() {
    $rel = get_query_var( 'otest_internal_app' );

    if ( $rel === '' || $rel === null ) {
        return;
    }

    // --- Access Control ---
    if ( ! otest_internal_apps_user_has_access() ) {
        // Standard WP redirect (no cookies)
        if ( ! is_user_logged_in() ) {
            auth_redirect();
            exit;
        }

        wp_die(
            esc_html__( 'You are logged in, but your account does not have permission to access internal applications.', 'otest-internal-apps' ),
            esc_html__( 'Access Denied', 'otest-internal-apps' ),
            array( 'response' => 403 )
        );
    }

    // --- Path Normalization ---
    $rel = ltrim( (string) $rel, "/\\" );
    $rel = str_replace( array('../', '..\\'), '', $rel );
    if ( $rel === '' || substr( $rel, -1 ) === '/' ) {
        $rel .= 'index.html';
    }

    // --- Resolve File ---
    $base_dir  = plugin_dir_path( __FILE__ ) . 'apps/';
    $base_real = realpath( $base_dir );

    if ( ! $base_real ) {
        status_header( 500 );
        echo 'Configuration error: apps directory not found.';
        exit;
    }

    $file = realpath( $base_real . DIRECTORY_SEPARATOR . $rel );

    // If directory, try index.html
    if ( $file && is_dir( $file ) ) {
        $maybe_index = realpath( $file . DIRECTORY_SEPARATOR . 'index.html' );
        if ( $maybe_index ) {
            $file = $maybe_index;
        }
    }

    // Security check
    if ( ! $file || strpos( $file, $base_real ) !== 0 || ! is_file( $file ) ) {
        status_header( 404 );
        echo 'File not found.';
        exit;
    }

    // --- Content Type ---
    $ext = strtolower( pathinfo( $file, PATHINFO_EXTENSION ) );
    $map = array(
        'html' => 'text/html; charset=utf-8',
        'htm'  => 'text/html; charset=utf-8',
        'js'   => 'text/javascript; charset=utf-8',
        'mjs'  => 'text/javascript; charset=utf-8',
        'css'  => 'text/css; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'png'  => 'image/png',
        'jpg'  => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif'  => 'image/gif',
        'svg'  => 'image/svg+xml',
        'ico'  => 'image/x-icon',
        'webp' => 'image/webp',
        'txt'  => 'text/plain; charset=utf-8',
        'pdf'  => 'application/pdf',
    );
    $content_type = isset( $map[ $ext ] ) ? $map[ $ext ] : 'application/octet-stream';

    nocache_headers();
    header( 'Content-Type: ' . $content_type );
    header( 'X-OTEST-Internal-Apps: 1' );

    // Handle Last-Modified
    $mtime = @filemtime( $file );
    if ( $mtime ) {
        header( 'Last-Modified: ' . gmdate( 'D, d M Y H:i:s', $mtime ) . ' GMT' );
    }

    if ( strtoupper( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) === 'HEAD' ) {
        exit;
    }

    readfile( $file );
    exit;
}
add_action( 'template_redirect', 'otest_internal_apps_serve_file', 0 );

/**
 * 5. SHORTCODE
 * Usage: [otest_internal_apps path="tool-name/index.html" height="900px"]
 */
function otest_internal_apps_shortcode( $atts ) {
    if ( ! otest_internal_apps_user_has_access() ) {
        if ( ! is_user_logged_in() ) {
            return '<p>You must <a href="' . esc_url( wp_login_url( get_permalink() ) ) . '">log in</a> to access this area.</p>';
        }
        return '<p>You do not have permission to access this area.</p>';
    }

    $atts = shortcode_atts(
        array(
            'path'   => '',
            'height' => '100vh',
        ),
        $atts,
        'otest_internal_apps'
    );

    $path = ltrim( $atts['path'], '/\\' );
    $src  = home_url( '/internal-apps/' . $path );

    // Validate height unit
    $height = preg_match( '/^\d+(\.\d+)?(vh|vw|px|%)$/', $atts['height'] ) ? $atts['height'] : '100vh';

    $html  = '<div class="otest-internal-apps-wrapper" style="width:100vw;height:' . esc_attr( $height ) . ';margin:0;padding:0;">';
    $html .= '<iframe src="' . esc_url( $src ) . '" style="width:100vw;height:' . esc_attr( $height ) . ';border:0;margin:0;padding:0;display:block;" loading="lazy"></iframe>';
    $html .= '</div>';

    return $html;
}
add_shortcode( 'otest_internal_apps', 'otest_internal_apps_shortcode' );

/**
 * 6. CSS OVERRIDES (Fullwidth)
 */
function otest_internal_apps_fullwidth_style() {
    global $post;
    if ( ! is_a( $post, 'WP_Post' ) || ! has_shortcode( $post->post_content, 'otest_internal_apps' ) ) {
        return;
    }
    ?>
    <style>
      .is-layout-constrained > :where(:not(.alignleft):not(.alignright):not(.alignfull)) {
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .wp-site-blocks {
        margin: 0 !important;
        padding: 0 !important;
        width: 100vw !important;
        max-width: 100vw !important;
      }
      .otest-internal-apps-wrapper,
      .otest-internal-apps-wrapper iframe {
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        margin: 0 !important;
        padding: 0 !important;
        display: block !important;
      }
      html, body {
        overflow-x: hidden !important;
      }
    </style>
    <?php
}
add_action( 'wp_head', 'otest_internal_apps_fullwidth_style' );
