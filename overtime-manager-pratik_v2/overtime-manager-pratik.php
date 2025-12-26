<?php
/**
 * Plugin Name: Overtime Manager (Pratik v3.5.0)
 * Description: Ücret Geçmişi (valid_from) + Haftalık toplamlar kaldırıldı (sadece aylık toplam kalır). Manager payroll hesabı ay/yıla göre doğru ücreti kullanır.
 * Version: 0.4.0
 * Author: ChatGPT
 */

// WordPress güvenlik önlemi: Eklenti dosyası doğrudan çağrılırsa
// WordPress ortamı yüklenmez. Bu kontrol, dosyanın yalnızca WordPress
// üzerinden çalıştırılmasını sağlar ve kötü amaçlı doğrudan erişimleri engeller.
if (!defined('ABSPATH')) { exit; }

// Veritabanı sürümü, gerektiğinde yapılandırma değişikliklerini takip edebilmek için tutuluyor.
// Bu değer yükseltildiğinde, eklenti tablo yapıları da güncellenebilir.
global $om_db_version;
$om_db_version = '0.4.0';

/**
 * Eklenti aktive olurken çalışan fonksiyon.
 *  - Mesai kayıtlarını saklayan ana tabloyu oluşturur.
 *  - Ücret geçmişini saklayan tabloyu oluşturur.
 *  - Yönetici kullanıcılarına gerekli yetkiyi verir.
 */
function om341_activate_plugin(){
    global $wpdb,$om_db_version;
    $overtimes = $wpdb->prefix.'overtimes';
    $rates     = $wpdb->prefix.'overtime_rates';
    $charset   = $wpdb->get_charset_collate();

    require_once(ABSPATH.'wp-admin/includes/upgrade.php');

    // Mesai kayıtlarını saklayan ana tabloyu oluştur.
    dbDelta("CREATE TABLE IF NOT EXISTS $overtimes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        work_date DATE NOT NULL,
        start_time TIME NULL,
        end_time TIME NULL,
        hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        company VARCHAR(20) NULL,
        break_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        net_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        calculated_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        note TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY user_id (user_id),
        KEY work_date (work_date)
    ) $charset;");

    // Çalışanların saatlik ücret geçmişini saklayan tabloyu oluştur.
    dbDelta("CREATE TABLE IF NOT EXISTS $rates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
        valid_from DATE NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY user_id (user_id),
        KEY valid_from (valid_from)
    ) $charset;");

    add_option('om_db_version',$om_db_version);

    // Tüm site yöneticilerine yönetici paneline erişmek için gerekli yetkiyi ver.
    $admin = get_role('administrator');
    if($admin && !$admin->has_cap('om_manage_all_overtimes')){
        $admin->add_cap('om_manage_all_overtimes');
    }
}
register_activation_hook(__FILE__,'om341_activate_plugin');

/**
 * Eklenti güncellendiğinde çalışır.
 * Daha önce kurulan sitelerde "company" kolonunun eklenip eklenmediğini kontrol eder.
 */
add_action('plugins_loaded','om341_maybe_upgrade');
function om341_maybe_upgrade(){
    global $wpdb;
    $t = $wpdb->prefix.'overtimes';

    if(!om_column_exists($t,'company')){
        // Kolon yoksa tablayı değiştirerek şirket bilgisini saklayabilmek için yeni alan ekleriz.
        $wpdb->query("ALTER TABLE $t ADD COLUMN company VARCHAR(20) NULL AFTER hours");
    }

    if(!om_column_exists($t,'break_hours')){
        $wpdb->query("ALTER TABLE $t ADD COLUMN break_hours DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER company");
    }

    if(!om_column_exists($t,'net_hours')){
        $wpdb->query("ALTER TABLE $t ADD COLUMN net_hours DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER break_hours");
    }

    if(!om_column_exists($t,'calculated_hours')){
        $wpdb->query("ALTER TABLE $t ADD COLUMN calculated_hours DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER net_hours");
    }

    om_refresh_calculated_hours();
}

function om_db_is_mysql(){
    global $wpdb;

    if(method_exists($wpdb,'is_mysql')){
        return $wpdb->is_mysql();
    }

    if(class_exists('WP_SQLite_DB') && $wpdb instanceof WP_SQLite_DB){
        return false;
    }

    if(property_exists($wpdb,'dbdriver') && stripos($wpdb->dbdriver,'sqlite')!==false){
        return false;
    }

    if(property_exists($wpdb,'db_driver') && stripos($wpdb->db_driver,'sqlite')!==false){
        return false;
    }

    if(property_exists($wpdb,'use_mysqli')){
        return (bool)$wpdb->use_mysqli;
    }

    return true;
}

function om_table_exists($table){
    global $wpdb;
    if(om_db_is_mysql()){
        return (bool)$wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $table));
    }

    return (bool)$wpdb->get_var($wpdb->prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=%s", $table));
}

function om_column_exists($table,$column){
    global $wpdb;

    if(!om_table_exists($table)){
        return false;
    }

    if(om_db_is_mysql()){
        return (bool)$wpdb->get_var($wpdb->prepare("SHOW COLUMNS FROM $table LIKE %s", $column));
    }

    $schema = $wpdb->get_results("PRAGMA table_info($table)");
    if(!$schema){
        return false;
    }
    foreach($schema as $col){
        if(isset($col->name) && strcasecmp($col->name,$column)===0){
            return true;
        }
    }
    return false;
}

/** Yardımcı fonksiyonlar (tekrar eden basit işlemler) */

/**
 * Şu anki kullanıcıya yönetici (om_manage_all_overtimes) yetkisi verilip verilmediğini kontrol eder.
 */
function om_is_manager(){ return current_user_can('om_manage_all_overtimes'); }

function om_get_form_page_url(){
    // Kısa kodu kullanan sayfayı bulmak için tüm yayınlanmış sayfaları tarıyoruz.
    $q = new WP_Query(array('post_type'=>'page','post_status'=>'publish','posts_per_page'=>-1,'fields'=>'ids'));
    if($q->have_posts()){
        foreach($q->posts as $pid){
            $c = get_post_field('post_content',$pid);
            if(strpos($c,'[om_overtime_form]')!==false || strpos($c,'[om31_overtime_form]')!==false){
                return get_permalink($pid);
            }
        }
    }
    // Hiçbir sayfada kısa kod bulunamazsa site ana sayfasına yönlendirmek güvenli bir varsayımdır.
    return home_url('/');
}

function om_get_list_page_url(){
    // Liste kısa koduna sahip sayfayı ararken aynı yaklaşımı kullanıyoruz.
    $q = new WP_Query(array('post_type'=>'page','post_status'=>'publish','posts_per_page'=>-1,'fields'=>'ids'));
    if($q->have_posts()){
        foreach($q->posts as $pid){
            $c = get_post_field('post_content',$pid);
            if(strpos($c,'[om_overtime_list]')!==false || strpos($c,'[om31_overtime_list]')!==false){
                return get_permalink($pid);
            }
        }
    }
    // Liste sayfası bulunamazsa yine ana sayfaya dönüyoruz.
    return home_url('/');
}

function om_get_allowed_years(){
    // Uygulamadaki tüm yıl seçimlerinin tutarlı olması için 2024-2030 aralığını sabitliyoruz.
    return range(2024, 2030);
}

function om_calc_hours($s,$e,$f){
    // Başlangıç/bitiş saatleri hem boş hem de sayısal girilebilir.
    // Fonksiyon öncelikle saatleri kullanmaya çalışır; geçersizse manuel girilen değeri döner.
    $s = $s?:'';
    $e = $e?:'';
    if($s!=='' && $e!==''){
        $S = strtotime($s);
        $E = strtotime($e);
        if($S!==false && $E!==false){
            if($E<$S){ $E+=24*3600; } // gece devri: bitiş ertesi güne kaydıysa 24 saat ekle.
            $d = ($E-$S)/3600;
            if($d>=0 && $d<=48) return round($d,2);
        }
    }
    // Saatler girilmediyse veya hesap geçersizse manuel girilen değeri kullan.
    return max(0,floatval($f));
}

function om_is_weekend($date){
    if(!$date){
        return false;
    }
    $ts = strtotime($date);
    if($ts === false){
        return false;
    }
    $day = intval(date('N',$ts)); // 1 = Pazartesi ... 7 = Pazar
    return $day >= 6;
}

function om_get_multiplier($date){
    return om_is_weekend($date) ? 2.5 : 1.5;
}

function om_calculate_hours_with_break($date,$hours,$break){
    $hours = max(0,floatval($hours));
    $break = max(0,floatval($break));
    if($break>$hours){
        $break=$hours;
    }
    $net = round($hours-$break,2);
    $mult = om_get_multiplier($date);
    $calc = round($net*$mult,2);
    return array($break,$net,$calc,$mult);
}

function om_sql_calculated_hours_fallback_expr(){
    $hours = 'COALESCE(hours,0)';
    $break = 'COALESCE(break_hours,0)';
    $net   = "CASE WHEN (($hours - $break) > 0) THEN ($hours - $break) ELSE 0 END";
    if(om_db_is_mysql()){
        $mult = 'CASE WHEN WEEKDAY(work_date) >= 5 THEN 2.5 ELSE 1.5 END';
    } else {
        $mult = "CASE WHEN CAST(strftime('%w', work_date) AS INTEGER) IN (0,6) THEN 2.5 ELSE 1.5 END";
    }
    return "ROUND($net * $mult,2)";
}

function om_sql_company_flag_expr($target){
    $normalized = "UPPER(TRIM(COALESCE(company,'')))";
    switch($target){
        case 'TCI':
            return "CASE WHEN $normalized='TCI' THEN 1 ELSE 0 END";
        case 'BILTIR':
            return "CASE WHEN $normalized='BILTIR' THEN 1 ELSE 0 END";
        case 'DIGER':
            return "CASE WHEN $normalized IN ('DIGER','DİGER','RENAULT') THEN 1 ELSE 0 END";
        default:
            return '0';
    }
}

function om_refresh_calculated_hours(){
    global $wpdb;
    $t = $wpdb->prefix.'overtimes';

    if(!om_table_exists($t)){
        return;
    }
    if(!om_column_exists($t,'break_hours') || !om_column_exists($t,'net_hours') || !om_column_exists($t,'calculated_hours')){
        return;
    }

    if(om_db_is_mysql()){
        $wpdb->query("UPDATE $t SET break_hours = LEAST(GREATEST(COALESCE(break_hours,0),0), COALESCE(hours,0))");
        $wpdb->query("UPDATE $t SET net_hours = ROUND(GREATEST(COALESCE(hours,0) - COALESCE(break_hours,0),0),2)");
        $wpdb->query("UPDATE $t SET calculated_hours = ROUND(GREATEST(COALESCE(hours,0) - COALESCE(break_hours,0),0) * CASE WHEN WEEKDAY(work_date) >= 5 THEN 2.5 ELSE 1.5 END,2)");
        return;
    }

    // SQLite: WEEKDAY fonksiyonu olmadığından kayıtları PHP tarafında tek tek hesaplıyoruz.
    $rows = $wpdb->get_results("SELECT id, work_date, hours, break_hours FROM $t");
    if(!$rows){
        return;
    }
    foreach($rows as $row){
        $hours = max(0,floatval($row->hours));
        $break = max(0,floatval($row->break_hours));
        if($break > $hours){
            $break = $hours;
        }
        list($break_adj,$net,$calc) = om_calculate_hours_with_break($row->work_date,$hours,$break);
        $wpdb->update(
            $t,
            array(
                'break_hours' => $break_adj,
                'net_hours' => $net,
                'calculated_hours' => $calc,
            ),
            array('id' => intval($row->id)),
            array('%f','%f','%f'),
            array('%d')
        );
    }
}

function om_styles(){
    // Form ve listelerin tutarlı görünmesi için basit CSS blokları dönüyoruz.
    // Bu değerler kısa kod çıktısına inline olarak ekleniyor.
    return '<style>
    .om31-field{margin-bottom:10px}
    .om31-field label{display:block;font-weight:600;margin-bottom:4px}
    .om31-input{width:100%;max-width:420px;padding:8px}
    .om31-input[readonly]{background:#f5f5f5;color:#555;cursor:not-allowed}
    .om31-btn{display:inline-block;background:#2271b1;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;text-decoration:none}
    .om31-btn-add{background:#2ea043}
    .om31-alert{padding:10px 12px;border-radius:4px;margin-bottom:12px}
    .om31-alert-success{background:#e7f7ed;border:1px solid #b7e1c3}
    .om31-alert-danger{background:#fdeaea;border:1px solid #f5c2c7}
    .om31-alert-warning{background:#fff4e5;border:1px solid #ffd8a8}
    .om31-note{font-size:12px;color:#555}
    table.om31-table{width:100%;border-collapse:collapse}
    .om31-table th,.om31-table td{border:1px solid #ddd;padding:8px;text-align:left}
    .om-rate{max-width:180px}
    .om-rates-table td,.om-rates-table th{padding:6px;border-bottom:1px solid #ddd}
    </style>';
}

/** Shortcode: FORM */
function om_sc_form(){
    // Giriş yapmamış kullanıcıların mesai formuna erişmesini engelliyoruz.
    if(!is_user_logged_in()) return '<div class="om31-alert om31-alert-warning">Giriş yapmalısınız.</div>';

    $u   = wp_get_current_user();
    $uid = $u->ID;

    // Yönetici yetkisine sahip kullanıcılar isterlerse başka bir çalışan adına kayıt oluşturabilir.
    if(om_is_manager() && isset($_REQUEST['user_id'])){
        $m = intval($_REQUEST['user_id']);
        if($m>0) $uid=$m;
    }

    // Form HTML'inin başına CSS'i ekliyoruz.
    $out = om_styles();

    // --- Silme işlemi ---
    // Formda "sil" butonuna basılırsa kayıt bu blokta işleniyor.
    if(isset($_POST['om31_delete']) && $_POST['om31_delete']=='1'){
        if(!wp_verify_nonce($_POST['om31_nonce'] ?? '','om31_manage')){
            return $out.'<div class="om31-alert om31-alert-danger">Güvenlik doğrulaması başarısız.</div>';
        }
        global $wpdb;
        $t   = $wpdb->prefix.'overtimes'; 
        $del = intval($_POST['delete_id'] ?? 0);
        if($del>0){
            $owner=$wpdb->get_var($wpdb->prepare("SELECT user_id FROM $t WHERE id=%d",$del));
            if($owner){
                if(!om_is_manager() && intval($owner)!==get_current_user_id()){
                    $out.='<div class="om31-alert om31-alert-danger">Bu kaydı silmeye yetkiniz yok.</div>';
                } else {
                    $wpdb->delete($t,array('id'=>$del),array('%d'));
                    $out.='<div class="om31-alert om31-alert-success">Kayıt silindi.</div>';
                }
            }else{
                $out.='<div class="om31-alert om31-alert-danger">Kayıt bulunamadı.</div>';
            }
        }
    }

    // --- Yeni kayıt ekleme veya mevcut kaydı güncelleme ---
    if(isset($_POST['om31_action']) && in_array($_POST['om31_action'],array('create','update'),true)){
        if(!wp_verify_nonce($_POST['om31_nonce'] ?? '','om31_manage')){
            return $out.'<div class="om31-alert om31-alert-danger">Güvenlik doğrulaması başarısız.</div>';
        }
        global $wpdb;
        $t      = $wpdb->prefix.'overtimes'; 
        $entry  = intval($_POST['user_id'] ?? $uid); 
        $d      = sanitize_text_field($_POST['work_date'] ?? '');
        $st     = sanitize_text_field($_POST['start_time'] ?? '');
        $et     = sanitize_text_field($_POST['end_time'] ?? '');
        $hrs_in = floatval($_POST['hours'] ?? 0);
        $break_in = floatval($_POST['break_hours'] ?? 0);
        $note   = sanitize_textarea_field($_POST['note'] ?? '');

        if(!om_is_manager() && $entry!==get_current_user_id()){
            return $out.'<div class="om31-alert om31-alert-danger">Bu işlem için yetkiniz yok.</div>';
        }

        // Firma whitelist + sanitize: Yalnızca belirlenen şirketler kabul edilir.
        $company = sanitize_text_field($_POST['company'] ?? '');
        $allowed_companies = array('TCI','DIGER','BILTIR');
        $company = in_array($company,$allowed_companies,true) ? $company : null;

        $hrs = om_calc_hours($st,$et,$hrs_in);
        list($break_hours,$net_hours,$calc_hours) = om_calculate_hours_with_break($d,$hrs,$break_in);

        if($_POST['om31_action']==='create'){
            // Yeni satır ekleyerek form verisini kaydet.
            $wpdb->insert(
                $t,
                array(
                    'user_id'   => $entry,
                    'work_date' => $d,
                    'start_time'=> $st?:null,
                    'end_time'  => $et?:null,
                    'hours'     => $hrs,
                    'company'   => $company,
                    'break_hours' => $break_hours,
                    'net_hours' => $net_hours,
                    'calculated_hours' => $calc_hours,
                    'note'      => $note,
                    'created_at'=> current_time('mysql'),
                    'updated_at'=> current_time('mysql'),
                ),
                array('%d','%s','%s','%s','%f','%s','%f','%f','%f','%s','%s','%s')
            );
            $out.='<div class="om31-alert om31-alert-success">Kayıt eklendi.</div>';
        } else {
            $id = intval($_POST['id'] ?? 0);
            if($id<=0) return $out.'<div class="om31-alert om31-alert-danger">Geçersiz kayıt.</div>';

            $owner = $wpdb->get_var($wpdb->prepare("SELECT user_id FROM $t WHERE id=%d",$id));
            if(!$owner) return $out.'<div class="om31-alert om31-alert-danger">Kayıt bulunamadı.</div>';
            if(!om_is_manager() && intval($owner)!==get_current_user_id()){
                return $out.'<div class="om31-alert om31-alert-danger">Yalnızca kendi kaydınızı düzenleyebilirsiniz.</div>';
            }

            // Güncelleme: Sadece seçili alanlar değiştirilir.
            $wpdb->update(
                $t,
                array(
                    'work_date' => $d,
                    'start_time'=> $st?:null,
                    'end_time'  => $et?:null,
                    'hours'     => $hrs,
                    'company'   => $company,
                    'break_hours' => $break_hours,
                    'net_hours' => $net_hours,
                    'calculated_hours' => $calc_hours,
                    'note'      => $note,
                ),
                array('id'=>$id),
                array('%s','%s','%s','%f','%s','%f','%f','%f','%s'),
                array('%d')
            );
            $out.='<div class="om31-alert om31-alert-success">Kayıt güncellendi.</div>';
        }
    }

    // --- Edit modu ---
    // URL'de edit_id varsa formu doldururken ilgili kayıt bilgilerini otomatik getir.
    $edit = isset($_GET['edit_id'])?intval($_GET['edit_id']):0;
    $ex   = null;
    if($edit){
        global $wpdb;
        $t  = $wpdb->prefix.'overtimes';
        $ex = $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE id=%d",$edit));
        if($ex){
            if(!om_is_manager() && intval($ex->user_id)!==get_current_user_id()){
                return $out.'<div class="om31-alert om31-alert-danger">Bu kaydı düzenlemeye yetkiniz yok.</div>';
            }
            $uid = intval($ex->user_id);
        }
    }

    // --- Form HTML çıktısı ---
    $company_current = ($ex && isset($ex->company)) ? $ex->company : '';
    $break_current = $ex ? number_format((float)$ex->break_hours,2,'.','') : '0.00';
    $net_current = $ex ? number_format((float)$ex->net_hours,2,'.','') : '';
    $calc_current = $ex ? number_format((float)$ex->calculated_hours,2,'.','') : '';
    $multiplier_current = $ex ? om_get_multiplier($ex->work_date) : om_get_multiplier('');

    // Formun okunabilirliğini artırmak için HTML'i tamponlayıp tek seferde ekliyoruz.
    ob_start();
    ?>
    <form method="post" class="om31-form">
        <?php
        // Form güvenliğini sağlamak için nonce alanını ekliyoruz (CSRF koruması).
        wp_nonce_field('om31_manage','om31_nonce', true, true);
        ?>

        <?php // Şirket seçimi çalışanların hangi projede görev yaptığını gösterir. ?>
        <div class="om31-field">
            <label>Firma</label>
            <select class="om31-input" name="company" required>
                <option value="">Seçiniz</option>
                <option value="TCI" <?php echo selected($company_current,'TCI',false); ?>>TCI</option>
                <option value="DIGER" <?php echo selected($company_current,'DIGER',false); ?>>DIGER</option>
                <option value="BILTIR" <?php echo selected($company_current,'BILTIR',false); ?>>BILTIR</option>
            </select>
        </div>

        <?php // Gizli alanlar işlem türünü ve güncellenecek kayıt id'sini taşır. ?>
        <input type="hidden" name="om31_action" value="<?php echo $ex ? 'update' : 'create'; ?>">
        <?php if($ex): ?>
            <input type="hidden" name="id" value="<?php echo intval($ex->id); ?>">
        <?php endif; ?>

        <?php // Yönetici başka bir kullanıcı adına çalışıyorsa doğru kullanıcı id'sini gönderiyoruz. ?>
        <input type="hidden" name="user_id" value="<?php echo esc_attr($uid); ?>">

        <?php // Mesainin ait olduğu tarih zorunlu alandır. ?>
        <div class="om31-field">
            <label>Tarih</label>
            <input class="om31-input" type="date" name="work_date" value="<?php echo esc_attr($ex ? $ex->work_date : ''); ?>" required>
        </div>

        <?php // Başlangıç saati otomatik saat hesabı için isteğe bağlıdır. ?>
        <div class="om31-field">
            <label>Başlangıç Saati</label>
            <input class="om31-input" type="time" name="start_time" value="<?php echo esc_attr($ex ? $ex->start_time : ''); ?>">
        </div>

        <?php // Bitiş saati girildiğinde gece devri hesaplaması yapılabilir. ?>
        <div class="om31-field">
            <label>Bitiş Saati</label>
            <input class="om31-input" type="time" name="end_time" value="<?php echo esc_attr($ex ? $ex->end_time : ''); ?>">
        </div>

        <?php // Manuel toplam saat alanı otomatik hesap yapılamadığında kullanılır. ?>
        <div class="om31-field">
            <label>Çalışılan Saat (toplam)</label>
            <input class="om31-input" type="number" step="0.25" min="0" name="hours" value="<?php echo esc_attr($ex ? $ex->hours : ''); ?>" required>
            <div class="om31-note" data-om-hours-note>Başlangıç/Bitiş girmezseniz elle girebilirsiniz.</div>
        </div>

        <div class="om31-field">
            <label>Mola Saati</label>
            <input class="om31-input" type="number" step="0.25" min="0" name="break_hours" value="<?php echo esc_attr($break_current); ?>">
        </div>

        <div class="om31-field">
            <label>Mola Sonrası Saat</label>
            <input class="om31-input" type="number" step="0.01" readonly data-om-net-hours value="<?php echo esc_attr($net_current); ?>">
        </div>

        <div class="om31-field">
            <label>Hesaplanan Mesai Saati <span data-om-multiplier>(kat sayı: <?php echo esc_html(number_format((float)$multiplier_current,1,'.','')); ?>x)</span></label>
            <input class="om31-input" type="number" step="0.01" readonly data-om-calculated-hours value="<?php echo esc_attr($calc_current); ?>">
        </div>

        <?php // Açıklama alanı vardiya hakkında kısa notlar eklemek içindir. ?>
        <div class="om31-field">
            <label>Açıklama</label>
            <textarea class="om31-input" name="note" rows="3"><?php echo esc_textarea($ex ? $ex->note : ''); ?></textarea>
        </div>

        <?php // Kullanıcı işlemi tamamlamak için butona basar. ?>
        <button class="om31-btn" type="submit"><?php echo $ex ? 'Güncelle' : 'Kaydet'; ?></button>
    </form>
    <script>
    (function (scriptEl) {
    document.addEventListener('DOMContentLoaded', function () {
        var form = scriptEl && scriptEl.previousElementSibling;
        if (!form || !form.classList || !form.classList.contains('om31-form')) {
            form = document.querySelector('.om31-form');
        }
        if (!form) { return; }

        var startInput = form.querySelector('input[name="start_time"]');
        var endInput = form.querySelector('input[name="end_time"]');
        var hoursInput = form.querySelector('input[name="hours"]');
        var breakInput = form.querySelector('input[name="break_hours"]');
        var netField = form.querySelector('[data-om-net-hours]');
        var calcField = form.querySelector('[data-om-calculated-hours]');
        var multiplierEl = form.querySelector('[data-om-multiplier]');
        var dateInput = form.querySelector('input[name="work_date"]');
        var noteEl = form.querySelector('[data-om-hours-note]');

        if (!hoursInput) { return; }

        function getMultiplier(dateValue) {
            if (!dateValue) { return 1.5; }
            var dateObj = new Date(dateValue + 'T00:00:00');
            if (isNaN(dateObj.getTime())) { return 1.5; }
            var day = dateObj.getDay();
            return (day === 0 || day === 6) ? 2.5 : 1.5;
        }

        function updateMultiplierDisplay(mult) {
            if (multiplierEl) {
                multiplierEl.textContent = '(kat sayı: ' + mult.toFixed(1) + 'x)';
            }
        }

        function updateDerived() {
            var hoursVal = parseFloat(hoursInput.value);
            if (isNaN(hoursVal) || hoursVal < 0) { hoursVal = 0; }

            var breakVal = 0;
            if (breakInput) {
                breakVal = parseFloat(breakInput.value);
                if (isNaN(breakVal) || breakVal < 0) { breakVal = 0; }
                if (breakVal > hoursVal) {
                    breakVal = hoursVal;
                    breakInput.value = hoursVal.toFixed(2);
                }
            }

            var net = Math.max(hoursVal - breakVal, 0);
            var multiplier = getMultiplier(dateInput ? dateInput.value : '');
            var calculated = net * multiplier;

            if (netField) {
                netField.value = net.toFixed(2);
            }
            if (calcField) {
                calcField.value = calculated.toFixed(2);
            }
            updateMultiplierDisplay(multiplier);
        }

        function parseTime(value) {
            var parts = value.split(':');
            if (parts.length < 2) { return null; }
            var h = parseInt(parts[0], 10);
            var m = parseInt(parts[1], 10);
            if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) { return null; }
            return h * 60 + m;
        }

        function setNote(autoFilled) {
            if (!noteEl) { return; }
            noteEl.textContent = autoFilled
                ? 'Başlangıç/Bitiş saatlerine göre otomatik hesaplandı.'
                : 'Başlangıç/Bitiş girmezseniz elle girebilirsiniz.';
        }

        function calculateHours() {
            if (!startInput || !endInput) {
                updateDerived();
                return;
            }

            var startValue = startInput.value.trim();
            var endValue = endInput.value.trim();

            var startMinutes = startValue ? parseTime(startValue) : null;
            var endMinutes = endValue ? parseTime(endValue) : null;

            if (startMinutes !== null && endMinutes !== null) {
                var diff = endMinutes - startMinutes;
                if (diff < 0) {
                    diff += 24 * 60;
                }

                if (diff >= 0 && diff <= 48 * 60) {
                    var rawHours = diff / 60;
                    var rounded = Math.round(rawHours * 4) / 4;
                    hoursInput.value = rounded.toFixed(2);
                    hoursInput.readOnly = true;
                    hoursInput.dataset.autoFilled = '1';
                    setNote(true);
                    updateDerived();
                    return;
                }
            }

            if (hoursInput.dataset.autoFilled === '1') {
                hoursInput.value = '';
            }
            delete hoursInput.dataset.autoFilled;
            hoursInput.readOnly = false;
            setNote(false);
            updateDerived();
        }

        if (startInput) {
            startInput.addEventListener('input', calculateHours);
            startInput.addEventListener('change', calculateHours);
        }
        if (endInput) {
            endInput.addEventListener('input', calculateHours);
            endInput.addEventListener('change', calculateHours);
        }

        hoursInput.addEventListener('input', updateDerived);
        hoursInput.addEventListener('change', updateDerived);
        if (breakInput) {
            breakInput.addEventListener('input', updateDerived);
            breakInput.addEventListener('change', updateDerived);
        }
        if (dateInput) {
            dateInput.addEventListener('change', updateDerived);
        }

        calculateHours();
        updateDerived();
    });
    })(document.currentScript);
    </script>
    <?php
    $out .= ob_get_clean();

    return $out;
}
add_shortcode('om_overtime_form','om_sc_form');

/** Shortcode: LIST (weekly totals removed) */
/** Shortcode: LIST (weekly totals removed) — Tüm Kullanıcılar filtresi eklendi */
/** Shortcode: LIST — Kullanıcı sütunu eklendi */
function om_sc_list($atts){
    if(!is_user_logged_in()) return '<div class="om31-alert om31-alert-warning">Giriş yapmalısınız.</div>';

    $atts = shortcode_atts(array('page_size'=>200),$atts,'om_overtime_list');
    $uid  = get_current_user_id();

    $month = isset($_GET['om_month']) ? intval($_GET['om_month']) : (isset($_GET['month']) ? intval($_GET['month']) : 0);
    $year  = isset($_GET['om_year'])  ? intval($_GET['om_year'])  : (isset($_GET['year'])  ? intval($_GET['year'])  : 0);
    $allowed_years = om_get_allowed_years();
    if($year>0 && !in_array($year,$allowed_years,true)){ $year = 0; }

    global $wpdb;
    $t   = $wpdb->prefix.'overtimes';
    $out = om_styles();

    $has_break = om_column_exists($t,'break_hours');
    $has_net   = om_column_exists($t,'net_hours');
    $has_calc  = om_column_exists($t,'calculated_hours');

    // Silme
    if(isset($_POST['om31_delete']) && $_POST['om31_delete']=='1'){
        if(!wp_verify_nonce($_POST['om31_nonce'] ?? '','om31_manage')){
            $out.='<div class="om31-alert om31-alert-danger">Güvenlik doğrulaması başarısız.</div>';
        } else {
            $del = intval($_POST['delete_id'] ?? 0);
            if($del>0){
                $owner=$wpdb->get_var($wpdb->prepare("SELECT user_id FROM $t WHERE id=%d",$del));
                if($owner){
                    if(!om_is_manager() && intval($owner)!==get_current_user_id()){
                        $out.='<div class="om31-alert om31-alert-danger">Bu kaydı silmeye yetkiniz yok.</div>';
                    } else {
                        $wpdb->delete($t,array('id'=>$del),array('%d'));
                        $out.='<div class="om31-alert om31-alert-success">Kayıt silindi。</div>';
                    }
                } else {
                    $out.='<div class="om31-alert om31-alert-danger">Kayıt bulunamadı.</div>';
                }
            }
        }
    }

    // Owner filtresi
    $where = '';
    $selected_user = isset($_GET['user']) ? intval($_GET['user']) : 0;
    if(om_is_manager()){
        if($selected_user === -1){
            $where = 'WHERE 1=1'; // tüm kullanıcılar
        } elseif($selected_user > 0){
            $where = $wpdb->prepare("WHERE user_id=%d",$selected_user);
        } else {
            $where = $wpdb->prepare("WHERE user_id=%d",$uid);
        }
    } else {
        $where = $wpdb->prepare("WHERE user_id=%d",$uid);
    }

    if($year>0){  $where .= $wpdb->prepare(" AND YEAR(work_date)=%d",$year); }
    if($month>0){ $where .= $wpdb->prepare(" AND MONTH(work_date)=%d",$month); }

    // CSV
    if(isset($_GET['om31_csv']) && $_GET['om31_csv']=='1'){
        $rows=$wpdb->get_results("SELECT * FROM $t $where ORDER BY work_date DESC, id DESC");
        om_array_to_csv_download('overtimes_export.csv',$rows);
    }

    $limit = max(1,intval($atts['page_size']));
    $rows  = $wpdb->get_results("SELECT * FROM $t $where ORDER BY work_date DESC, id DESC LIMIT $limit");

    // Aylık toplamlar
    $monthly_map = array();
    $m = $wpdb->get_results("SELECT DATE_FORMAT(work_date,'%Y-%m') as ym, SUM(COALESCE(calculated_hours,0)) as total FROM $t $where GROUP BY ym");
    foreach($m as $mr){ $monthly_map[strval($mr->ym)] = round(floatval($mr->total),2); }

    $monthly_by_company = array();
    $mc = $wpdb->get_results("
        SELECT DATE_FORMAT(work_date,'%Y-%m') AS ym, company, SUM(COALESCE(calculated_hours,0)) AS total
        FROM $t
        $where
        GROUP BY ym, company
    ");
    foreach($mc as $row){
        $ym = strval($row->ym);
        $co = strval($row->company);
        if(strcasecmp($co,'RENAULT')===0){ $co = 'DIGER'; }
        if(!isset($monthly_by_company[$ym])){ $monthly_by_company[$ym] = array('TCI'=>0,'DIGER'=>0,'BILTIR'=>0); }
        if(isset($monthly_by_company[$ym][$co])){ $monthly_by_company[$ym][$co] = round(floatval($row->total),2); }
    }

    // Üst toplamlar
    $sum_parts = array("SUM(hours) AS total_hours");
    $sum_parts[] = $has_break ? "SUM(COALESCE(break_hours,0)) AS total_break" : "0 AS total_break";
    $sum_parts[] = $has_net   ? "SUM(COALESCE(net_hours,0)) AS total_net"     : "0 AS total_net";
    $sum_parts[] = $has_calc  ? "SUM(COALESCE(calculated_hours,0)) AS total_calc" : "0 AS total_calc";
    $totals = $wpdb->get_row('SELECT '.implode(', ',$sum_parts)." FROM $t $where");
    $page_total       = $totals && $totals->total_hours !== null ? round(floatval($totals->total_hours),2) : 0;
    $page_break_total = $totals && $totals->total_break !== null ? round(floatval($totals->total_break),2) : 0;
    $page_net_total   = $totals && $totals->total_net   !== null ? round(floatval($totals->total_net),2)   : 0;
    $page_calc_total  = $totals && $totals->total_calc  !== null ? round(floatval($totals->total_calc),2)  : 0;

    // Filtre formu
    $out.='<form method="get" class="om31-filter" style="margin-bottom:12px">';
    if(om_is_manager()){
        $users=get_users(array('fields'=>array('ID','display_name')));
        $out.='<select name="user">';
        $out.='<option value="-1"'.($selected_user===-1?' selected':'').'>Tüm Kullanıcılar</option>';
        $out.='<option value="0"'.($selected_user===0?' selected':'').'>Kullanıcı (Ben)</option>';
        foreach($users as $u){
            $sel=($selected_user===intval($u->ID))?' selected':'';
            $out.='<option value="'.intval($u->ID).'"'.$sel.'>'.esc_html($u->display_name.' (#'.intval($u->ID).')').'</option>';
        }
        $out.='</select> ';
    }
    $out.='<select name="om_month"><option value="0">Ay (tümü)</option>';
    for($mm=1;$mm<=12;$mm++){ $sel=($month===$mm)?'selected':''; $out.='<option value="'.$mm.'" '.$sel.'>'.$mm.'</option>'; }
    $out.='</select> ';
    $out.='<select name="om_year"><option value="0">Yıl (tümü)</option>';
    foreach($allowed_years as $allowed_year){ $sel=($year===$allowed_year)?'selected':''; $out.='<option value="'.$allowed_year.'" '.$sel.'>'.$allowed_year.'</option>'; }
    $out.='</select> ';
    $out.='<button class="om31-btn" type="submit">Filtrele</button> ';
    $csv=esc_url(add_query_arg(array_merge($_GET,array('om31_csv'=>'1'))));
    $out.='<a class="om31-btn" href="'.$csv.'">CSV İndir</a> ';
    $out.='<a class="om31-btn om31-btn-add" href="'.esc_url(om_get_form_page_url()).'">Mesai Ekle</a>';
    $out.='</form>';

    $out.='<div style="margin-bottom:8px;">'
        .'<strong>Bu listeye göre TOPLAM (Ham) Saat:</strong> '.esc_html(number_format($page_total,2,'.',''))
        .' &nbsp;|&nbsp; <strong>Mola Toplamı:</strong> '.esc_html(number_format($page_break_total,2,'.',''))
        .' &nbsp;|&nbsp; <strong>Net Saat:</strong> '.esc_html(number_format($page_net_total,2,'.',''))
        .' &nbsp;|&nbsp; <strong>Hesaplanan Saat:</strong> '.esc_html(number_format($page_calc_total,2,'.',''))
        .'</div>';

    // Kullanıcı sütununu ne zaman gösterelim?
    // Yöneticiyse her zaman; normal kullanıcıda gizli.
    $show_user_col = om_is_manager();

    $form_url=om_get_form_page_url();

    // TABLO
    $out.='<table class="om31-table"><thead><tr>'
        .'<th>Tarih</th>'
        .($show_user_col ? '<th>Kullanıcı</th>' : '')
        .'<th>Ham Saat</th><th>Mola</th><th>Net Saat</th><th>Katsayı</th><th>Hesaplanan Saat</th>'
        .'<th>Başlangıç</th><th>Bitiş</th><th>Açıklama</th>'
        .'<th>Firma</th><th>Aylık Hesaplanan</th><th>TCI (Aylık)</th><th>DIGER (Aylık)</th><th>BILTIR (Aylık)</th><th>İşlem</th>'
        .'</tr></thead><tbody>';

    if($rows){
        foreach($rows as $r){
            $can = om_is_manager() || intval($r->user_id)===$uid;
            $ym  = date('Y-m', strtotime($r->work_date));
            $mt  = isset($monthly_map[$ym]) ? $monthly_map[$ym] : 0;

            $tci    = isset($monthly_by_company[$ym]['TCI'])    ? $monthly_by_company[$ym]['TCI']    : 0;
            $other  = isset($monthly_by_company[$ym]['DIGER'])  ? $monthly_by_company[$ym]['DIGER']  : 0;
            $biltir = isset($monthly_by_company[$ym]['BILTIR']) ? $monthly_by_company[$ym]['BILTIR'] : 0;

            $edit=add_query_arg(array('edit_id'=>intval($r->id)),$form_url);
            $multiplier = om_get_multiplier($r->work_date);

            $hours    = floatval($r->hours);
            $break_val= ($r->break_hours !== null)     ? floatval($r->break_hours)     : null;
            $net_val  = ($r->net_hours !== null)       ? floatval($r->net_hours)       : null;
            $calc_val = ($r->calculated_hours !== null)? floatval($r->calculated_hours): null;

            if($break_val === null || $net_val === null || $calc_val === null){
                list($break_val,$net_val,$calc_val) = om_calculate_hours_with_break($r->work_date,$hours,$break_val ?? 0);
            }

            // Kullanıcı adı
            $owner = get_user_by('id', $r->user_id);
            $owner_name = $owner ? ($owner->display_name.' (#'.$r->user_id.')') : '#'.$r->user_id;

            $out.='<tr>';
            $out.='<td>'.esc_html($r->work_date).'</td>';
            if($show_user_col){
                $out.='<td>'.esc_html($owner_name).'</td>';
            }
            $out.='<td>'.esc_html(number_format($hours,2,'.','')).'</td>';
            $out.='<td>'.esc_html(number_format($break_val,2,'.','')).'</td>';
            $out.='<td>'.esc_html(number_format($net_val,2,'.','')).'</td>';
            $out.='<td>'.esc_html(number_format((float)$multiplier,1,'.','')).'x</td>';
            $out.='<td>'.esc_html(number_format($calc_val,2,'.','')).'</td>';
            $out.='<td>'.esc_html($r->start_time).'</td>';
            $out.='<td>'.esc_html($r->end_time).'</td>';
            $out.='<td>'.esc_html($r->note).'</td>';
            $out.='<td>'.esc_html($r->company).'</td>';
            $out.='<td>'.esc_html(number_format((float)$mt,2,'.','')).'</td>';
            $out.='<td>'.esc_html(number_format((float)$tci,2,'.','')).'</td>';
            $out.='<td>'.esc_html(number_format((float)$other,2,'.','')).'</td>';
            $out.='<td>'.esc_html(number_format((float)$biltir,2,'.','')).'</td>';
            $out.='<td>';
            if($can){
                $out.='<a class="om31-btn" href="'.esc_url($edit).'">Düzenle</a> ';
                $out.='<form method="post" style="display:inline;margin-left:6px">'.wp_nonce_field('om31_manage','om31_nonce',true,false).'
                       <input type="hidden" name="om31_delete" value="1">
                       <input type="hidden" name="delete_id" value="'.intval($r->id).'">
                       <button class="om31-btn" type="submit" onclick="return confirm(\'Bu kaydı silmek istediğinize emin misiniz?\')">Sil</button>
                       </form>';
            } else { $out.='—'; }
            $out.='</td></tr>';
        }
    } else {
        $out.='<tr><td colspan="'.($show_user_col?16:15).'">Kayıt bulunamadı.</td></tr>';
    }
    $out.='</tbody></table>';
    return $out;
}
add_shortcode('om_overtime_list','om_sc_list');



/**
 * Tarih query var'ları (year/month) yüzünden özel sayfa 404'e düşmesin
 * Slug: mesai-listem  (gerekirse değiştir)
 */
add_action('pre_get_posts', 'om_neutralize_date_query_on_overtime_page');
function om_neutralize_date_query_on_overtime_page($q){
    if (is_admin() || !$q->is_main_query()) return;
    if (!$q->is_page()) return;

    $pagename = $q->get('pagename');
    if (!$pagename) return;

    // Bu slug'ı sitendeki gerçek slug ile eşleştir
    if ($pagename === 'mesai-listem') {
        // URL'de year/month parametreleri varsa WordPress sayfayı tarih arşivi zannedip 404'e düşürebilir.
        // Bu alanları temizleyerek özel liste sayfasının doğru şekilde açılmasını sağlıyoruz.
        if (isset($_GET['year']) || isset($_GET['month']) || isset($_GET['m'])) {
            $q->set('year', '');
            $q->set('monthnum', '');
            $q->set('m', '');
            $q->is_date = false;
        }
    }
}

/** User Profile: default hourly rate + history UI */
function om_user_rate_meta($user){ 
    if(!om_is_manager()) return; 
    $rate=get_user_meta($user->ID,'om_hourly_rate',true);

    // Kullanıcının varsayılan saatlik ücretini düzenleyebileceğimiz alan.
    echo '<h2>Overtime — Saatlik Ücret</h2>
    <table class="form-table">
      <tr>
        <th><label for="om_hourly_rate">Saatlik Ücret (₺)</label></th>
        <td>
          <input type="number" step="0.01" min="0" class="regular-text om-rate" name="om_hourly_rate" id="om_hourly_rate" value="'.esc_attr($rate).'">
          <p class="description">Varsayılan ücret. Ücret geçmişi yoksa bu kullanılır.</p>
        </td>
      </tr>
    </table>';

    global $wpdb; 
    $rt=$wpdb->prefix.'overtime_rates'; 
    $rows=$wpdb->get_results($wpdb->prepare("SELECT * FROM $rt WHERE user_id=%d ORDER BY valid_from DESC",$user->ID));

    echo '<h2>Overtime — Ücret Geçmişi</h2>';
    echo '<table class="form-table"><tr><th>Geçmiş</th><td>';
    echo '<table class="om-rates-table"><thead><tr><th>valid_from (tarih)</th><th>Saatlik Ücret (₺)</th><th>Sil</th></tr></thead><tbody>';
    if($rows){
        // Her geçmiş kaydı ayrı satır olarak listelenir; istersek aynı ekranda silme seçeneğini işaretleyebiliriz.
        foreach($rows as $r){
            echo '<tr><td>'.esc_html($r->valid_from).'</td><td>'.esc_html(number_format((float)$r->hourly_rate,2,'.','')).'</td><td><label><input type="checkbox" name="om_rate_delete[]" value="'.intval($r->id).'"> Sil</label></td></tr>';
        }
    } else { 
        echo '<tr><td colspan="3">Kayıt yok.</td></tr>'; 
    }
    echo '</tbody></table></td></tr>';

    echo '<tr><th>Yeni Ücret Kaydı</th>
      <td>
        <input type="date" name="om_rate_valid_from" value=""> 
        <input type="number" step="0.01" min="0" name="om_rate_value" placeholder="ör. 300.00"> 
        <p class="description">valid_from: Ücretin geçerli olmaya başladığı tarih.</p>
      </td>
    </tr></table>';
}
add_action('show_user_profile','om_user_rate_meta');
add_action('edit_user_profile','om_user_rate_meta');

function om_save_user_rate_meta($user_id){
    if(!om_is_manager()) return;

    // Profil ekranındaki varsayılan ücret alanını kaydet.
    if(isset($_POST['om_hourly_rate'])){
        update_user_meta($user_id,'om_hourly_rate',floatval($_POST['om_hourly_rate']));
    }

    global $wpdb;
    $rt=$wpdb->prefix.'overtime_rates';

    // Silme: Yönetici geçmiş listesinde işaretlenen kayıtları kaldırabilir.
    if(isset($_POST['om_rate_delete']) && is_array($_POST['om_rate_delete'])){
        foreach($_POST['om_rate_delete'] as $rid){
            $wpdb->delete($rt,array('id'=>intval($rid),'user_id'=>$user_id),array('%d','%d'));
        }
    }

    // Yeni kayıt: Geçerlilik tarihi ve ücret bilgisi doğruysa yeni satır eklenir.
    $vf  = isset($_POST['om_rate_valid_from']) ? sanitize_text_field($_POST['om_rate_valid_from']) : '';
    $val = isset($_POST['om_rate_value']) ? floatval($_POST['om_rate_value']) : null;

    if($vf && $val !== null && $val >= 0){
        $wpdb->insert(
            $rt,
            array('user_id'=>$user_id,'hourly_rate'=>$val,'valid_from'=>$vf,'created_at'=>current_time('mysql')),
            array('%d','%f','%s','%s')
        );
    }
}
add_action('personal_options_update','om_save_user_rate_meta'); 
add_action('edit_user_profile_update','om_save_user_rate_meta');

/** Payroll helpers */
function om_rate_for_month($user_id,$year,$month){
    global $wpdb;
    $rt=$wpdb->prefix.'overtime_rates';

    // Ay veya yıl belirtilmemişse en güncel geçerli ücreti döndürürüz.
    if(!$year || !$month){
        $row=$wpdb->get_row($wpdb->prepare("SELECT * FROM $rt WHERE user_id=%d ORDER BY valid_from DESC LIMIT 1",$user_id));
        if($row) return array(floatval($row->hourly_rate), $row->valid_from);
        $meta=floatval(get_user_meta($user_id,'om_hourly_rate',true));
        return array($meta, '');
    }

    $last_day = date('Y-m-t', strtotime(sprintf('%04d-%02d-01',$year,$month)));
    // Belirtilen ayın son günü baz alınarak geriye dönük en uygun ücret kaydı bulunur.
    $row=$wpdb->get_row($wpdb->prepare("SELECT * FROM $rt WHERE user_id=%d AND valid_from <= %s ORDER BY valid_from DESC LIMIT 1",$user_id,$last_day));
    if($row) return array(floatval($row->hourly_rate), $row->valid_from);

    $meta=floatval(get_user_meta($user_id,'om_hourly_rate',true));
    return array($meta, '');
}

/** Admin page */
function om_admin_page(){
    if(!om_is_manager()) wp_die('Yetkiniz yok.');
    global $wpdb;
    $t=$wpdb->prefix.'overtimes';

    $has_break = om_column_exists($t,'break_hours');
    $has_net   = om_column_exists($t,'net_hours');
    $has_calc  = om_column_exists($t,'calculated_hours');

    // Yönetici filtre alanlarından gelen değerleri oku (yoksa 0 = tüm kayıtlar).
    $month = isset($_GET['om_month']) ? intval($_GET['om_month']) : (isset($_GET['month']) ? intval($_GET['month']) : 0);
    $year  = isset($_GET['om_year'])  ? intval($_GET['om_year'])  : (isset($_GET['year'])  ? intval($_GET['year'])  : 0);
    $allowed_years = om_get_allowed_years();
    if($year>0 && !in_array($year,$allowed_years,true)){
        $year = 0;
    }

    // Tüm kayıtları seçen temel WHERE cümlesi, filtre geldikçe genişler.
    $where = 'WHERE 1=1';
    if($year>0){  $where .= $wpdb->prepare(" AND YEAR(work_date)=%d",$year);}
    if($month>0){ $where .= $wpdb->prepare(" AND MONTH(work_date)=%d",$month);}

    // Ham CSV: Filtreye uyan tüm satırları ham haliyle dışa aktarır.
    if(isset($_GET['om31_csv']) && $_GET['om31_csv']=='1'){
        $rows=$wpdb->get_results("SELECT * FROM $t $where ORDER BY user_id, work_date DESC, id DESC");
        om_array_to_csv_download('overtimes_all.csv',$rows);
    }

    // Payroll CSV: Maaş hesabı için kullanıcı bazlı toplam saatleri ve ücretleri çıkarır.
    if(isset($_GET['om31_payroll_csv']) && $_GET['om31_payroll_csv']=='1'){
        $select_parts = array('user_id','SUM(hours) as total_hours');
        $calc_expr_sql = om_sql_calculated_hours_fallback_expr();
        $calc_value_sql = $has_calc ? "COALESCE(NULLIF(calculated_hours,0), $calc_expr_sql)" : $calc_expr_sql;
        $flag_tci   = om_sql_company_flag_expr('TCI');
        $flag_diger = om_sql_company_flag_expr('DIGER');
        $flag_biltir= om_sql_company_flag_expr('BILTIR');
        $select_parts[] = "SUM($calc_value_sql) as total_calc_hours";
        $select_parts[] = "SUM(($calc_value_sql) * $flag_tci) as total_calc_tci";
        $select_parts[] = "SUM(($calc_value_sql) * $flag_diger) as total_calc_diger";
        $select_parts[] = "SUM(($calc_value_sql) * $flag_biltir) as total_calc_biltir";
        $per_user=$wpdb->get_results('SELECT '.implode(', ',$select_parts)." FROM $t $where GROUP BY user_id ORDER BY user_id ASC");
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="overtime_payroll.csv"');
        $out=fopen('php://output','w');
        fputcsv($out,array(
            'User ID','User Name','Rate Used (TRY)','Rate valid_from','Ham Saat','Aylık Hesaplanan',
            'TCI (Aylık)','DIGER (Aylık)','BILTIR (Aylık)',
            'TCI (Aylık) ödenecek','DIGER (Aylık) ödenecek','BILTIR (Aylık) ödenecek','Total (Aylık) ödenecek','Yıl','Ay'
        ));
        foreach($per_user as $p){
            list($rate,$vf)=om_rate_for_month($p->user_id,$year,$month);
            $u=get_user_by('id',$p->user_id);
            $uname=$u?$u->display_name:'#'.$p->user_id;
            $hrs=round(floatval($p->total_hours),2);
            $calc_total=round(floatval($p->total_calc_hours ?? 0),2);
            $calc_tci=round(floatval($p->total_calc_tci ?? 0),2);
            $calc_diger=round(floatval($p->total_calc_diger ?? 0),2);
            $calc_biltir=round(floatval($p->total_calc_biltir ?? 0),2);
            $rate_val=floatval($rate);
            $pay_tci=round($calc_tci*$rate_val,2);
            $pay_diger=round($calc_diger*$rate_val,2);
            $pay_biltir=round($calc_biltir*$rate_val,2);
            $pay_total=round($calc_total*$rate_val,2);
            fputcsv($out,array(
                $p->user_id,$uname,$rate,$vf,$hrs,$calc_total,$calc_tci,$calc_diger,$calc_biltir,
                $pay_tci,$pay_diger,$pay_biltir,$pay_total,$year ?: '-', $month ?: '-'
            ));
        }
        fclose($out);
        exit;
    }

    $select_parts = array('user_id','SUM(hours) as total_hours');
    $calc_expr_sql = om_sql_calculated_hours_fallback_expr();
    $calc_value_sql = $has_calc ? "COALESCE(NULLIF(calculated_hours,0), $calc_expr_sql)" : $calc_expr_sql;
    $flag_tci   = om_sql_company_flag_expr('TCI');
    $flag_diger = om_sql_company_flag_expr('DIGER');
    $flag_biltir= om_sql_company_flag_expr('BILTIR');
    $select_parts[] = "SUM($calc_value_sql) as total_calc_hours";
    $select_parts[] = "SUM(($calc_value_sql) * $flag_tci) as total_calc_tci";
    $select_parts[] = "SUM(($calc_value_sql) * $flag_diger) as total_calc_diger";
    $select_parts[] = "SUM(($calc_value_sql) * $flag_biltir) as total_calc_biltir";
    $select_parts[] = 'COUNT(*) as cnt';
    $per_user=$wpdb->get_results('SELECT '.implode(', ',$select_parts)." FROM $t $where GROUP BY user_id ORDER BY user_id ASC");
    $list_url = om_get_list_page_url();

    echo '<div class="wrap"><h1>Overtime Yönetici Paneli</h1>';
    echo '<form method="get" style="margin:12px 0">';
    // WordPress admin sayfalarında hangi menü ekranında olduğumuzu "page" parametresi belirler.
    // Bu gizli alan doğru slugu göndererek filtreleme yaptıktan sonra yine aynı sayfada kalmamızı sağlar.
    echo '<input type="hidden" name="page" value="om31-overtime" />';

    // Ay filtresi: 0 değerini "tüm aylar" olarak kullanıyoruz, böylece yönetici isterse filtreyi temizleyebilir.
    echo '<select name="om_month"><option value="0">Ay (tümü)</option>';
    for($m=1;$m<=12;$m++){
        $sel=($month===$m)?'selected':'';
        echo '<option '.$sel.' value="'.$m.'">'.$m.'</option>';
    }
    echo '</select> ';
    // Yıl filtresi: uygulama 2024-2030 aralığında çalışacak şekilde sabitlendi.
    echo '<select name="om_year"><option value="0">Yıl (tümü)</option>';
    foreach($allowed_years as $allowed_year){
        $sel=($year===$allowed_year)?'selected':'';
        echo '<option '.$sel.' value="'.$allowed_year.'">'.$allowed_year.'</option>';
    }
    echo '</select> ';
    submit_button('Filtrele','primary','',false);

    // Aşağıdaki bağlantılar mevcut filtre parametrelerini (ay/yıl gibi) koruyarak ek olarak CSV bayraklarını ekler.
    // Böylece yönetici aynı filtre sonucu için ham veriyi ya da maaş özetini indirebilir.
    echo ' <a class="button button-primary" href="'.esc_url(add_query_arg(array_merge($_GET,array('om31_csv'=>'1')))).'">Ham CSV</a>';
    echo ' <a class="button button-primary" href="'.esc_url(add_query_arg(array_merge($_GET,array('om31_payroll_csv'=>'1')))).'">Ücret CSV</a>';
    echo '</form>';

    echo '<h2>Çalışan Bazlı Toplamlar (Ücret Geçmişi ile)</h2>';
    echo '<table class="widefat striped"><thead><tr><th>Kullanıcı</th><th>Kayıt Sayısı</th><th>Ham Saat</th><th>Aylık Hesaplanan</th><th>TCI (Aylık)</th><th>DIGER (Aylık)</th><th>BILTIR (Aylık)</th><th>Kullanılan Ücret (₺)</th><th>valid_from</th><th>TCI (Aylık) ödenecek</th><th>DIGER (Aylık) ödenecek</th><th>BILTIR (Aylık) ödenecek</th><th>Total (Aylık) ödenecek</th><th>İşlem</th></tr></thead><tbody>';
    if($per_user){
        foreach($per_user as $p){
            $u=get_user_by('id',$p->user_id);
            $uname=$u ? esc_html($u->display_name.' (#'.$p->user_id.')') : '#'.$p->user_id;
            list($rate,$vf) = om_rate_for_month($p->user_id,$year,$month);
            $hrs=round(floatval($p->total_hours),2);
            $calc_total=round(floatval($p->total_calc_hours ?? 0),2);
            $calc_tci=round(floatval($p->total_calc_tci ?? 0),2);
            $calc_diger=round(floatval($p->total_calc_diger ?? 0),2);
            $calc_biltir=round(floatval($p->total_calc_biltir ?? 0),2);
            $rate_value=floatval($rate);
            $pay_tci=round($calc_tci*$rate_value,2);
            $pay_diger=round($calc_diger*$rate_value,2);
            $pay_biltir=round($calc_biltir*$rate_value,2);
            $pay_total=round($calc_total*$rate_value,2);
            $detail = add_query_arg(array('user'=>$p->user_id),$list_url);
            echo '<tr><td>'.$uname.'</td><td>'.intval($p->cnt).'</td><td>'.number_format($hrs,2,'.','').'</td><td>'.number_format($calc_total,2,'.','').'</td><td>'.number_format($calc_tci,2,'.','').'</td><td>'.number_format($calc_diger,2,'.','').'</td><td>'.number_format($calc_biltir,2,'.','').'</td><td>'.number_format((float)$rate,2,'.','').'</td><td>'.esc_html($vf ?: '-').'</td><td>'.number_format($pay_tci,2,'.','').'</td><td>'.number_format($pay_diger,2,'.','').'</td><td>'.number_format($pay_biltir,2,'.','').'</td><td><strong>'.number_format($pay_total,2,'.','').'</strong></td><td><a class="button" href="'.esc_url($detail).'" target="_blank">Detay</a></td></tr>';
        }
    } else {
        echo '<tr><td colspan="14">Kayıt bulunamadı.</td></tr>';
    }
    echo '</tbody></table>';
    echo '</div>';
}
function om_register_menu(){
    if(!om_is_manager()) return;
    // Yönetici menüsüne "Overtime" başlıklı yeni bir sayfa ekleyerek paneli görünür kılıyoruz.
    add_menu_page('Overtime','Overtime','om_manage_all_overtimes','om31-overtime','om_admin_page','dashicons-clock',26);
}
add_action('admin_menu','om_register_menu');

/** CSV helper (Firma sütunu eklendi) */
function om_array_to_csv_download($filename,$rows){
    if(!is_array($rows)) $rows=array();
    // Tarayıcıya CSV çıktısı gönderileceğini bildir.
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="'.$filename.'"');
    $out=fopen('php://output','w');
    // Başlık satırı okuyucuların sütunları anlamasını sağlar.
    fputcsv($out,array('ID','User ID','User Name','Tarih','Baslangic','Bitis','Saat','Mola','Net Saat','Katsayi','Hesaplanan Saat','Firma','Aciklama'));
    foreach($rows as $r){
        $u=get_user_by('id',$r->user_id);
        $uname=$u ? $u->display_name : '#'.$r->user_id;
        // Her kayıt CSV'ye sayısal formatlanmış saatlerle yazılır.
        fputcsv($out,array(
            $r->id,$r->user_id,$uname,$r->work_date,$r->start_time,$r->end_time,
            number_format((float)$r->hours,2,'.',''),
            number_format((float)$r->break_hours,2,'.',''),
            number_format((float)$r->net_hours,2,'.',''),
            number_format((float)om_get_multiplier($r->work_date),1,'.',''),
            number_format((float)$r->calculated_hours,2,'.',''),
            $r->company,
            $r->note
        ));
    }
    fclose($out); exit;
}
?>
