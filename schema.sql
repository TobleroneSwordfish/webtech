drop table if exists characters;
drop table if exists teamkills;
drop table if exists fanart;
drop table if exists users;
CREATE TABLE characters (id BIGINT PRIMARY KEY, username VARCHAR(100), suicides INT, teamkills INT, healing_ticks INT, resurrections INT, times_revived INT, faction_id BIGINT, last_login TIMESTAMP);
CREATE TABLE teamkills (id BIGINT PRIMARY KEY AUTO_INCREMENT, victim_id BIGINT, attacker_id BIGINT);
CREATE TABLE fanart (id BIGINT PRIMARY KEY AUTO_INCREMENT, filename VARCHAR(100) UNIQUE, approved BOOL);
CREATE TABLE users (id BIGINT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(100) UNIQUE, password_hash VARCHAR(100), admin BOOL);
CREATE TABLE comments (id BIGINT PRIMARY KEY AUTO_INCREMENT, fanart_id BIGINT, user_id BIGINT, parent_id BIGINT, content VARCHAR(500));