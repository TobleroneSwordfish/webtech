drop table if exists characters;
drop table if exists teamkills;
CREATE TABLE characters (id BIGINT PRIMARY KEY, username VARCHAR(100), suicides INT, teamkills INT, healing_ticks INT, resurrections INT, times_revived INT, faction_id BIGINT, last_login TIMESTAMP);
CREATE TABLE teamkills (id BIGINT PRIMARY KEY AUTO_INCREMENT, victim_id BIGINT, attacker_id BIGINT);