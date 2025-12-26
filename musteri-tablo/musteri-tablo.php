<?php
/**
 * Plugin Name: Musteri Tablo Goruntuleyici
 * Description: Automatically detects 'client_*.csv' files matching user roles and displays them in a full-width DataTable.
 * Version: 3.12.0
 * Author: OTEST
 * Text Domain: musteri-tablo
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Ensure the upload directory constant is defined
if ( ! defined( 'MUSTERI_CSV_DIR' ) ) {
    define( 'MUSTERI_CSV_DIR', WP_CONTENT_DIR . '/uploads/private_csv/' );
}

/**
 * 1. ASSETS
 */
function musteri_tablo_enqueue_assets() {
    // Only load if the shortcode is present or we are on specific pages (optional optimization)
    // For now, we register them and enqueue inside the shortcode.
    wp_register_style(
        'datatables-css',
        'https://cdn.datatables.net/v/dt/dt-2.1.8/r-3.0.3/datatables.min.css',
        array(),
        '2.1.8'
    );

    wp_register_script(
        'datatables-js',
        'https://cdn.datatables.net/v/dt/dt-2.1.8/r-3.0.3/datatables.min.js',
        array( 'jquery' ),
        '2.1.8',
        true
    );
}
add_action( 'wp_enqueue_scripts', 'musteri_tablo_enqueue_assets' );

/**
 * 2. FILE HANDLING
 */
function musteri_list_available_csvs() {
    $dir = rtrim( MUSTERI_CSV_DIR, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR;
    
    // Safety check for directory existence
    if ( ! is_dir( $dir ) ) {
        return array();
    }

    $out = array();
    foreach ( glob( $dir . '*.csv' ) as $path ) {
        $base = basename( $path, '.csv' );
        // Only accept files starting with 'client_'
        if ( ! str_starts_with( $base, 'client_' ) ) {
            continue;
        }
        if ( is_file( $path ) ) {
            $out[ $base ] = $path;
        }
    }
    return $out;
}

/**
 * 3. RENDER HELPERS
 */
function musteri_render_csv_table_datatables( $table_id, $csv_path, $title = '' ) {
    if ( ! file_exists( $csv_path ) ) {
        return '<p>Dosya bulunamadı.</p>';
    }

    $rows = array();
    if ( ( $h = fopen( $csv_path, 'r' ) ) !== false ) {
        while ( ( $data = fgetcsv( $h, 0, ',' ) ) !== false ) {
            $rows[] = $data;
        }
        fclose( $h );
    }

    if ( empty( $rows ) ) {
        return '<p>Tablo boş.</p>';
    }

    $header = array_shift( $rows );

    ob_start();
    ?>
    <style>
        /* Local Table Styles */
        .musteri-csv-block {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            display: block;
            box-sizing: border-box;
        }
        .musteri-csv-wrapper {
            width: 100%;
            overflow-x: auto;
            margin: 0 !important;
            padding: 0 !important;
        }
        .musteri-csv-wrapper table.dataTable {
            width: 100% !important;
            font-size: 0.85rem;
            border-collapse: collapse;
        }
        .musteri-csv-wrapper table.dataTable th,
        .musteri-csv-wrapper table.dataTable td {
            padding: 4px 8px;
            white-space: nowrap;
        }
        .musteri-csv-wrapper table.dataTable thead th {
            border-bottom: 2px solid #ddd;
            background-color: #f1f1f1;
            font-weight: 600;
        }
        .musteri-csv-wrapper table.dataTable tbody tr:nth-child(even) {
            background-color: #fafafa;
        }
        .musteri-csv-wrapper table.dataTable tbody tr:hover {
            background-color: #f0f8ff;
        }
    </style>

    <div class="musteri-csv-block">
        <?php if ( $title !== '' ): ?>
            <h3 style="margin: 0 0 10px 0; padding: 0 5px;"><?php echo esc_html( $title ); ?></h3>
        <?php endif; ?>
        
        <div class="musteri-csv-wrapper">
            <table id="<?php echo esc_attr( $table_id ); ?>" class="display stripe compact" style="width:100%;">
                <thead>
                    <tr>
                        <?php foreach ( $header as $col ): ?>
                            <th><?php echo esc_html( $col ); ?></th>
                        <?php endforeach; ?>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ( $rows as $r ): ?>
                        <tr>
                            <?php foreach ( $r as $cell ): ?>
                                <td><?php echo esc_html( $cell ); ?></td>
                            <?php endforeach; ?>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>

    <script>
    jQuery(function($){
        $('#<?php echo esc_js( $table_id ); ?>').DataTable({
            responsive: false,
            paging: true,
            pageLength: 25,
            lengthMenu: [10, 25, 50, 100, 250],
            searching: true,
            ordering: true,
            info: true,
            autoWidth: false,
            scrollX: true,
            order: [[0, 'desc']],
            language: {
                // Optional: Localize if needed, currently English defaults
            }
        });
    });
    </script>
    <?php
    return ob_get_clean();
}

function musteri_pretty_title_from_basename( $basename ) {
    $name = $basename;
    if ( str_starts_with( $name, 'client_' ) ) {
        $name = substr( $name, 7 );
    }
    return strtoupper( str_replace( array('-', '_'), ' ', $name ) );
}

function musteri_render_dataset_selector( $select_id, $allowed_map, $selected_base = '' ) {
    if ( empty( $allowed_map ) ) {
        return '';
    }
    
    if ( ! $selected_base || ! isset( $allowed_map[ $selected_base ] ) ) {
        $keys = array_keys( $allowed_map );
        $selected_base = reset( $keys );
    }

    ob_start(); ?>
    <div style="margin: 0 0 15px 0; padding: 10px; background: #f9f9f9; border-bottom: 1px solid #ddd;">
        <label for="<?php echo esc_attr( $select_id ); ?>" style="font-weight:bold;">Firma Seçiniz:</label>
        <select id="<?php echo esc_attr( $select_id ); ?>" style="margin-left: 10px; max-width: 300px; padding: 5px;">
            <?php foreach ( $allowed_map as $base => $_path ): ?>
                <option value="<?php echo esc_attr( $base ); ?>" <?php selected( $selected_base, $base ); ?>>
                    <?php echo esc_html( musteri_pretty_title_from_basename( $base ) ); ?>
                </option>
            <?php endforeach; ?>
        </select>
        <script>
        jQuery(function($){
            $('#<?php echo esc_js( $select_id ); ?>').on('change', function(){
                var v = $(this).val() || '';
                var url = new URL(window.location.href);
                if (v) { 
                    url.searchParams.set('file', v); 
                } else { 
                    url.searchParams.delete('file'); 
                }
                window.location.href = url.toString();
            });
        });
        </script>
    </div>
    <?php return ob_get_clean();
}

/**
 * 4. SHORTCODE
 */
function musteri_tablosu_shortcode( $atts ) {
    // 1. Auth Check
    if ( ! is_user_logged_in() ) {
        return '<p>Bu içeriği görmek için <a href="' . esc_url( wp_login_url( get_permalink() ) ) . '">giriş yapmalısınız</a>.</p>';
    }

    // 2. Load Assets
    wp_enqueue_style( 'datatables-css' );
    wp_enqueue_script( 'datatables-js' );

    $user      = wp_get_current_user();
    $is_admin  = current_user_can( 'manage_options' );
    $files_map = musteri_list_available_csvs();

    if ( empty( $files_map ) ) {
        return '<p>Sistemde kayıtlı veri dosyası bulunamadı.</p>';
    }

    // Get requested file from URL
    $qs_file = isset( $_GET['file'] ) ? sanitize_file_name( wp_unslash( $_GET['file'] ) ) : '';

    // --- ADMIN LOGIC ---
    if ( $is_admin ) {
        if ( count( $files_map ) === 1 ) {
            $base = array_key_first( $files_map );
            return musteri_render_csv_table_datatables(
                'csv_' . esc_attr( $base ), 
                $files_map[ $base ],
                musteri_pretty_title_from_basename( $base )
            );
        }

        $selected = ( $qs_file && isset( $files_map[ $qs_file ] ) ) ? $qs_file : array_key_first( $files_map );
        
        $out  = musteri_render_dataset_selector( 'musteri_admin_ds_select', $files_map, $selected );
        $out .= musteri_render_csv_table_datatables( 
            'csv_' . esc_attr( $selected ), 
            $files_map[ $selected ],
            musteri_pretty_title_from_basename( $selected )
        );
        return $out;
    }

    // --- USER LOGIC ---
    // Match user roles to CSV filenames (e.g., role 'editor' sees 'client_editor.csv')
    $user_roles = (array) $user->roles; 
    $allowed    = array();

    foreach ( $user_roles as $role_slug ) {
        // Check if a client_{role}.csv exists
        $candidate = 'client_' . $role_slug;
        if ( isset( $files_map[ $candidate ] ) ) {
            $allowed[ $candidate ] = $files_map[ $candidate ];
        }
        // Also check exact match if filenames don't use prefix (fallback)
        if ( isset( $files_map[ $role_slug ] ) ) {
            $allowed[ $role_slug ] = $files_map[ $role_slug ];
        }
    }

    if ( empty( $allowed ) ) {
        return '<p>Hesabınıza atanmış bir veri dosyası bulunamadı.</p>';
    }

    if ( count( $allowed ) === 1 ) {
        $base = array_key_first( $allowed );
        return musteri_render_csv_table_datatables(
            'csv_' . esc_attr( $base ),
            $allowed[ $base ], 
            musteri_pretty_title_from_basename( $base )
        );
    }

    $selected = ( $qs_file && isset( $allowed[ $qs_file ] ) ) ? $qs_file : array_key_first( $allowed );
    
    $out  = musteri_render_dataset_selector( 'musteri_ds_select', $allowed, $selected );
    $out .= musteri_render_csv_table_datatables(
        'csv_' . esc_attr( $selected ),
        $allowed[ $selected ], 
        musteri_pretty_title_from_basename( $selected )
    );
    
    return $out;
}
add_shortcode( 'musteri_tablosu', 'musteri_tablosu_shortcode' );

/**
 * 5. CSS OVERRIDES (Fullwidth)
 */
function musteri_fullwidth_style() {
    global $post;
    if ( ! is_a( $post, 'WP_Post' ) || ! has_shortcode( $post->post_content, 'musteri_tablosu' ) ) {
        return;
    }
    ?>
    <style>
      /* Force full width for the content area */
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
      /* Ensure body doesn't scroll horizontally if not needed */
      html, body {
        overflow-x: hidden !important;
      }
      /* The container itself */
      .musteri-csv-block {
          width: 98vw !important; /* Slightly less than 100 to prevent scrollbar flicker */
          margin-left: 1vw !important;
      }
    </style>
    <?php
}
add_action( 'wp_head', 'musteri_fullwidth_style' );

/**
 * 6. REST API (Upload Handling)
 */
add_action( 'rest_api_init', function () {
    register_rest_route( 'musteri/v1', '/upload', array(
        'methods'             => 'POST',
        'callback'            => 'musteri_handle_csv_upload',
        'permission_callback' => function() {
            return current_user_can( 'manage_options' );
        },
    ));
});

function musteri_handle_csv_upload( WP_REST_Request $r ) {
    $p = $r->get_json_params();
    
    if ( empty( $p['filename'] ) || empty( $p['content'] ) ) {
        return new WP_REST_Response( array( 'error' => 'Eksik parametreler.' ), 400 );
    }

    $f = basename( sanitize_file_name( $p['filename'] ) );
    
    // Additional security: Force .csv extension
    if ( pathinfo( $f, PATHINFO_EXTENSION ) !== 'csv' ) {
         return new WP_REST_Response( array( 'error' => 'Sadece CSV dosyaları yüklenebilir.' ), 400 );
    }

    $c = base64_decode( $p['content'] );
    if ( $c === false ) {
        return new WP_REST_Response( array( 'error' => 'Base64 decode hatası.' ), 400 );
    }

    $d = rtrim( MUSTERI_CSV_DIR, DIRECTORY_SEPARATOR ) . DIRECTORY_SEPARATOR;
    
    if ( ! file_exists( $d ) ) {
        if ( ! wp_mkdir_p( $d ) ) {
             return new WP_REST_Response( array( 'error' => 'Dizin oluşturulamadı.' ), 500 );
        }
    }
    
    // Create index.html to prevent directory listing if it doesn't exist
    if ( ! file_exists( $d . 'index.html' ) ) {
        file_put_contents( $d . 'index.html', '' ); // Silence is golden
    }

    $path = $d . $f;
    
    return file_put_contents( $path, $c ) === false
        ? new WP_REST_Response( array( 'error' => 'Dosya yazılamadı.' ), 500 )
        : new WP_REST_Response( array( 'status' => 'ok', 'path' => $path ), 200 );
}